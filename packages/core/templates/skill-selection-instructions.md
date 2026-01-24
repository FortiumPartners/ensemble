# Skill Selection Instructions

This document provides guidance for agentic skill selection during `/init-project`.

**Important**: Skill selection is an intelligent reasoning task, NOT a lookup table. You must explore the available skills, understand what each provides, and reason about which would genuinely benefit this specific project.

---

## Agentic Selection Approach

### Philosophy

You are not executing a matching algorithm. You are an intelligent agent that:
1. **Explores** the skill library to understand what's available
2. **Reads** skill documentation to understand each skill's purpose
3. **Reasons** about which skills would provide genuine value
4. **Considers** both explicit matches and complementary value

### How to Select Skills

**Step 1: Discover Available Skills**

Use Glob to find all skills: `packages/skills/*/SKILL.md`

For each skill, read its "When to Use" section to understand:
- What technology it covers
- What triggers its use
- What value it provides

**Step 2: Reason About Relevance**

For each skill, consider multiple dimensions of value:

1. **Direct Match**: Is this technology explicitly present in the detected stack?
   - Example: `prisma/schema.prisma` exists → `using-prisma` is directly relevant

2. **Ecosystem Fit**: Does this skill fit the project's ecosystem even if not explicitly used?
   - Example: Python project → `pytest` is likely valuable even without explicit config
   - Example: TypeScript project → `developing-with-typescript` provides foundational patterns

3. **Complementary Value**: Would this skill help with likely future needs?
   - Example: Web API without deployment → deployment skills might be valuable
   - Example: React without styling → Tailwind skill could help

4. **Not Every Match Is Valuable**: Just because a technology could be used doesn't mean the skill is needed
   - A simple project may not need every potentially-relevant skill
   - Consider project complexity and scope

**Step 3: Categorize Your Selections**

Group skills by confidence:

- **High Confidence**: Direct match found in codebase - auto-include
- **Medium Confidence**: Strong ecosystem fit - include with note
- **Low Confidence**: Tangentially related - ask user before including

---

## Reference: Common Skill Mappings

The following associations help you recognize skill relevance. Use them as reference for your reasoning, not as rigid rules.

### Language Skills
- Python projects often benefit from `developing-with-python`
- TypeScript projects often benefit from `developing-with-typescript`
- PHP projects often benefit from `developing-with-php`

### Framework Skills
- React projects → `developing-with-react`
- Laravel projects → `developing-with-laravel`
- Flutter projects → `developing-with-flutter`
- NestJS projects → `nestjs`

### Testing Skills
- Jest-configured projects → `jest`
- pytest-configured projects → `pytest`
- RSpec-configured projects → `rspec`
- Playwright-configured projects → `writing-playwright-tests`

### Infrastructure Skills
- Prisma-using projects → `using-prisma`
- Railway-deployed projects → `managing-railway`
- Vercel-deployed projects → `managing-vercel`
- Supabase-using projects → `managing-supabase`

### AI Platform Skills
- Anthropic/Claude SDK usage → `using-anthropic-platform`
- OpenAI SDK usage → `using-openai-platform`
- LangGraph usage → `building-langgraph-agents`

---

## How to Copy Skills

For each matched skill:

1. Copy the entire skill folder from `packages/skills/<skill-name>/` to `.claude/skills/<skill-name>/`
2. Include all files:
   - `SKILL.md` (required)
   - `REFERENCE.md` (if exists)
   - `templates/` (if exists)
   - `examples/` (if exists)

### Step 4: Core Skills (Always Include)

Some skills should always be included regardless of stack:

- Prompt engineering patterns (if available)
- Claude Code plugin development (if available)
- Testing strategies for non-deterministic systems (if available)

---

## Skill Library Structure

Each skill in `packages/skills/` follows this structure:

```
<skill-name>/
├── SKILL.md              # Quick reference (required)
├── REFERENCE.md          # Comprehensive guide (optional)
├── templates/            # Code generation templates (optional)
└── examples/             # Real-world examples (optional)
```

### SKILL.md Format

Each `SKILL.md` should have a "When to Use" section near the top:

```markdown
## When to Use

This skill is loaded by `backend-developer` when:
- `<package>` in `requirements.txt` or `pyproject.toml`
- `<package>` in `package.json` dependencies
- Environment variables `<VAR>` present
- User mentions "<keyword>" in task
```

---

## Selection Confidence

For each skill, assess whether it should be included:

| Confidence | Action |
|------------|--------|
| High (direct match) | Include automatically |
| Medium (related technology) | Include, note in report |
| Low (tangentially related) | Ask user before including |

---

## Output Report

After selection, report to the user:

```markdown
## Skills Selected

### Automatically Included (High Confidence)
- `developing-with-python` - Python detected in requirements.txt
- `using-prisma` - Prisma schema found

### Included (Medium Confidence)
- `pytest` - Python project, pytest commonly used

### Not Included (Available if Needed)
- `using-celery` - No Celery detected
- `managing-railway` - No Railway config found

### How to Add More Skills
Use `/add-skill <skill-name>` to add additional skills later.
```

---

## Edge Cases

1. **No matching skills**: Copy only core skills, inform user
2. **Multiple language stacks**: Copy skills for all detected languages
3. **Monorepo**: Analyze each workspace, union all skills
4. **Unknown framework**: Check if similar skill exists, ask user

---

## Skill Availability Check

Before copying, verify the skill exists in the plugin library:

```
packages/skills/<skill-name>/SKILL.md
```

If a skill is expected but not found:
1. Log a warning
2. Continue without that skill
3. Report missing skill to user

---

*This document guides the LLM during /init-project skill selection. It is NOT executable code.*
