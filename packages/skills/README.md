# Ensemble vNext Skills Library

This directory contains skill definitions for the Ensemble vNext plugin.

## What are Skills?

Skills are Markdown files that encode domain expertise and best practices. They are interpreted by Claude at runtime, not executed as code.

## Skill Structure

Each skill is organized in its own directory:

```
skills/
  skill-name/
    SKILL.md        # Quick reference (<100KB)
    REFERENCE.md    # Comprehensive patterns (optional, <1MB)
    examples/       # Real-world examples (optional)
    templates/      # Code templates (optional)
```

## Creating a New Skill

1. Create a directory with the skill name (kebab-case)
2. Create `SKILL.md` with YAML frontmatter:

```markdown
---
name: skill-name
description: Brief description of the skill
allowed-tools: Read, Write, Edit, Bash
---

# Skill Name

Content here...
```

## Available Skills

Skills are loaded dynamically based on the project's technology stack.

See individual skill directories for documentation.
