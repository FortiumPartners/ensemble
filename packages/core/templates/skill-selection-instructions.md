# Skill Selection Instructions

This document provides instructions for the LLM to select and copy relevant skills during `/init-project`.

**Important**: Skill selection is an LLM function, NOT executable code. The LLM reviews the generated `stack.md` and matches against available skills in the plugin library.

---

## Selection Process

### Step 1: Read stack.md

Parse the generated `stack.md` to extract:
- Primary language(s)
- Framework(s)
- Testing framework(s)
- Database/ORM
- Infrastructure/deployment targets
- CI/CD platform

### Step 2: Match Against Skill Library

The skill library is located at `packages/skills/` in the plugin.

Each skill has a `SKILL.md` with a "When to Use" section that defines triggering conditions.

**Matching Rules**:

| stack.md Entry | Skill Match |
|----------------|-------------|
| Language: Python | `developing-with-python` |
| Language: TypeScript | `developing-with-typescript` |
| Language: PHP | `developing-with-php` |
| Framework: React | `developing-with-react` |
| Framework: Laravel | `developing-with-laravel` |
| Framework: Flutter | `developing-with-flutter` |
| Framework: NestJS | `nestjs` |
| Testing: Jest | `jest` |
| Testing: pytest | `pytest` |
| Testing: RSpec | `rspec` |
| Testing: xUnit | `xunit` |
| Testing: ExUnit | `exunit` |
| Testing: Playwright | `writing-playwright-tests` |
| Database: Prisma | `using-prisma` |
| Database: Weaviate | `using-weaviate` |
| Infrastructure: Railway | `managing-railway` |
| Infrastructure: Vercel | `managing-vercel` |
| Infrastructure: Supabase | `managing-supabase` |
| AI: Anthropic/Claude | `using-anthropic-platform` |
| AI: OpenAI | `using-openai-platform` |
| AI: Perplexity | `using-perplexity-platform` |
| AI: LangGraph | `building-langgraph-agents` |
| Background Jobs: Celery | `using-celery` |
| Styling: Tailwind | `styling-with-tailwind` |
| Issue Tracker: Jira | `managing-jira-issues` |
| Issue Tracker: Linear | `managing-linear-issues` |

### Step 3: Copy Matched Skills

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
