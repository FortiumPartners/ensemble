---
name: generate-project-router-rules
description: Generate project-specific router rules by analyzing the project's tech stack
allowed-tools: Read, Write, Grep, Glob
---

# Generate Project Router Rules

Analyze the current project's technology stack and generate a project-specific
`.claude/router-rules.json` file that extends the global routing rules with
project-specific triggers, skills, and agent recommendations.

## Overview

Project router rules are merged with global rules at runtime. Project rules:
- Add project-specific triggers to existing agent categories
- Map project technologies to relevant skills
- Define project context for stronger routing recommendations

## Phase 1: Project Analysis

### 1.1 Detect Package Manager and Dependencies

Scan for dependency files:

**Actions:**
- Check for `package.json` (Node.js/npm/yarn/pnpm)
- Check for `requirements.txt`, `pyproject.toml`, `Pipfile` (Python)
- Check for `Gemfile` (Ruby)
- Check for `go.mod` (Go)
- Check for `Cargo.toml` (Rust)
- Check for `composer.json` (PHP)
- Check for `*.csproj`, `*.sln` (C#/.NET)

### 1.2 Identify Frameworks

Analyze dependencies to detect frameworks:

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| React | `react` in dependencies | `jest` |
| Next.js | `next` in dependencies | `vercel`, `jest` |
| NestJS | `@nestjs/core` in dependencies | `jest`, `nestjs` |
| Rails | `rails` in Gemfile | `rspec`, `rails` |
| Phoenix | `phoenix` in mix.exs | `exunit`, `phoenix` |
| Flutter | `pubspec.yaml` exists | `flutter` |
| Blazor | Blazor references in .csproj | `xunit`, `blazor` |

### 1.3 Detect Infrastructure

Look for infrastructure patterns:

**Actions:**
- Check for `vercel.json`, `.vercel/` → Vercel deployment
- Check for `railway.json`, `railway.toml` → Railway deployment
- Check for `fly.toml` → Fly.io deployment
- Check for `docker-compose.yml`, `Dockerfile` → Docker
- Check for `.github/workflows/` → GitHub Actions
- Check for `supabase/` → Supabase backend

### 1.4 Identify Testing Frameworks

Detect test configuration:

**Actions:**
- `jest.config.*` → Jest testing
- `pytest.ini`, `pyproject.toml` with pytest → pytest
- `spec/` directory with Ruby → RSpec
- `playwright.config.*` → Playwright E2E
- `cypress.config.*` → Cypress E2E

## Phase 2: Rules Generation

### 2.1 Build Triggers Map

Based on detected technologies, build project-specific triggers:

```json
{
  "triggers": {
    "development": ["<project-specific-terms>"],
    "infrastructure_build": ["<deployment-platform>", "<ci-cd-tool>"],
    "quality_testing": ["<test-framework>"]
  }
}
```

### 2.2 Build Skills Mapping

Map detected technologies to relevant skills:

```json
{
  "skill_mappings": {
    "<framework-name>": ["<skill1>", "<skill2>"],
    "<platform-name>": ["<skill>"]
  }
}
```

### 2.3 Build Project Context

Create project context hints:

```json
{
  "project_context": {
    "primary_language": "<language>",
    "framework": "<framework>",
    "deployment": "<platform>",
    "testing": ["<test-framework1>", "<test-framework2>"]
  }
}
```

## Phase 3: Generate Rules File

### 3.1 Assemble Project Rules

Create the project-specific rules structure:

```json
{
  "version": "1.0.0",
  "generated": "ISO-8601 timestamp",
  "project_name": "<detected-from-package.json-or-directory>",

  "triggers": {
    "development": ["nextjs", "react", "typescript"],
    "infrastructure_build": ["vercel", "github actions"],
    "quality_testing": ["jest", "playwright"]
  },

  "skill_mappings": {
    "nextjs": ["vercel", "jest"],
    "react": ["jest"],
    "deployment": ["vercel"],
    "testing": ["jest", "playwright-test"]
  },

  "project_context": {
    "primary_language": "TypeScript",
    "framework": "Next.js",
    "deployment": "Vercel",
    "testing": ["Jest", "Playwright"]
  }
}
```

### 3.2 Write Rules File

**Actions:**
- Create `.claude/` directory if it doesn't exist
- Write rules to `.claude/router-rules.json`
- Report summary of detected technologies

## Expected Output

A `.claude/router-rules.json` file containing:

1. **triggers** - Project-specific keywords to add to agent categories
2. **skill_mappings** - Keyword → skill associations for the project
3. **project_context** - High-level project technology summary

## How Project Rules Work

At runtime, the router:
1. Loads global rules from `~/.claude/hooks/router/router-rules.json`
2. Checks for `.claude/router-rules.json` in the current working directory
3. Merges project rules into global rules
4. Marks matched agents/skills from project rules as `[PROJECT-SPECIFIC]`
5. Uses stronger hint language for project-specific matches

## Usage

```
/generate-project-router-rules
```

Run this command in any project directory to generate project-specific routing rules.
The generated rules will enhance routing accuracy for that project's technology stack.

## Example Output

For a Next.js project deployed on Vercel with Jest tests:

```json
{
  "version": "1.0.0",
  "generated": "2025-12-28T12:00:00Z",
  "project_name": "my-nextjs-app",
  "triggers": {
    "development": ["nextjs", "next.js", "react", "typescript", "tsx"],
    "infrastructure_build": ["vercel", "preview deployment", "edge function"]
  },
  "skill_mappings": {
    "nextjs": ["vercel", "jest"],
    "react": ["jest"],
    "typescript": ["jest"],
    "deploy": ["vercel"],
    "test": ["jest"]
  },
  "project_context": {
    "primary_language": "TypeScript",
    "framework": "Next.js 14",
    "deployment": "Vercel",
    "testing": ["Jest"]
  }
}
```

This will cause the router to strongly recommend Vercel and Jest skills
whenever the user mentions Next.js, deployment, or testing in that project.
