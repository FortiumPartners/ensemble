---
name: generate-project-router-rules
description: Generate project-specific router rules by analyzing the project's tech stack
allowed-tools: Read, Write, Grep, Glob
---

# Generate Project Router Rules

Analyze the current project's technology stack and generate a project-specific
`.claude/router-rules.json` that extends the global routing rules.

## Phase 1: Project Analysis

### 1.1 Detect Technology Stack

Scan the project for technology indicators:

| File | Detection |
|------|-----------|
| `package.json` | Node.js, check dependencies for React, Vue, Angular, Next.js, NestJS |
| `requirements.txt` / `pyproject.toml` | Python, check for FastAPI, Django, Flask |
| `Gemfile` | Ruby, check for Rails |
| `mix.exs` | Elixir, check for Phoenix |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `*.csproj` | .NET |
| `pubspec.yaml` | Flutter/Dart |

### 1.2 Detect Testing Frameworks

Identify test frameworks in use:

| Pattern | Framework |
|---------|-----------|
| `jest.config.*` | Jest |
| `vitest.config.*` | Vitest |
| `pytest.ini` / `conftest.py` | pytest |
| `.rspec` | RSpec |
| `mix.exs` with ExUnit | ExUnit |
| `Playwright` in dependencies | Playwright |

### 1.3 Detect Infrastructure

Identify infrastructure components:

| Pattern | Component |
|---------|-----------|
| `docker-compose.yml` | Docker |
| `Dockerfile` | Docker |
| `kubernetes/` or `k8s/` | Kubernetes |
| `helm/` or `charts/` | Helm |
| `.github/workflows/` | GitHub Actions |
| `vercel.json` | Vercel |
| `railway.json` | Railway |

## Phase 2: Generate Rules

### 2.1 Create Skill Mappings

Map detected technologies to skills:

```json
{
  "skill_mappings": {
    "react": ["developing-with-react"],
    "typescript": ["developing-with-typescript"],
    "jest": ["jest"],
    "pytest": ["pytest"]
  }
}
```

### 2.2 Add Project Triggers

Add project-specific triggers for detected technologies:

```json
{
  "triggers": {
    "development": ["specific-framework-terms"],
    "quality_testing": ["detected-test-framework"]
  }
}
```

### 2.3 Define Custom Agents (optional)

If the project has custom agents defined, add them:

```json
{
  "custom_agents": {
    "project-specialist": {
      "description": "Project-specific agent",
      "triggers": ["project-terms"]
    }
  }
}
```

## Phase 3: Write Rules

### 3.1 Create Project Rules File

Write to `.claude/router-rules.json`:

```json
{
  "version": "1.0.0",
  "generated": "ISO-8601 timestamp",
  "project": "project-name",
  "skill_mappings": {...},
  "triggers": {...},
  "custom_agents": {...},
  "project_context": {
    "frontend": ["detected-frontend-skills"],
    "backend": ["detected-backend-skills"],
    "testing": ["detected-test-skills"]
  }
}
```

## Expected Output

A `.claude/router-rules.json` file that:

1. Maps project technologies to appropriate skills
2. Adds project-specific triggers for routing
3. Defines any custom project agents
4. Provides project context for better routing decisions

The router hook will automatically merge these rules with global rules,
giving project-specific matches higher priority.

## Usage

```
/generate-project-router-rules
```

Run this after `/init-project` or when the project's tech stack changes.
