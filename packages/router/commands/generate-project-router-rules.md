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

Analyze dependencies to detect frameworks and map to skills:

#### Frontend Frameworks

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| React | `react` in package.json dependencies | `react`, `jest` |
| Next.js | `next` in package.json | `vercel`, `react`, `jest` |
| Vue | `vue` in package.json | `jest` |
| Nuxt | `nuxt` in package.json | `jest` |
| Angular | `@angular/core` in package.json | `jest` |
| Svelte | `svelte` in package.json | `jest` |
| SvelteKit | `@sveltejs/kit` in package.json | `jest` |
| Remix | `@remix-run/react` in package.json | `react`, `jest` |
| Astro | `astro` in package.json | `jest` |
| Gatsby | `gatsby` in package.json | `react`, `jest` |
| Solid.js | `solid-js` in package.json | `jest` |
| Qwik | `@builder.io/qwik` in package.json | `jest` |

#### Backend Frameworks (Node.js)

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| NestJS | `@nestjs/core` in package.json | `nestjs`, `jest` |
| Express | `express` in package.json | `jest` |
| Fastify | `fastify` in package.json | `jest` |
| Hono | `hono` in package.json | `jest` |
| Koa | `koa` in package.json | `jest` |
| AdonisJS | `@adonisjs/core` in package.json | `jest` |

#### Backend Frameworks (Python)

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| Django | `django` in requirements.txt or pyproject.toml | `pytest` |
| Flask | `flask` in requirements.txt or pyproject.toml | `pytest` |
| FastAPI | `fastapi` in requirements.txt or pyproject.toml | `pytest` |
| Starlette | `starlette` in requirements.txt or pyproject.toml | `pytest` |
| Pyramid | `pyramid` in requirements.txt | `pytest` |

#### Backend Frameworks (Ruby)

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| Rails | `rails` in Gemfile | `rails`, `rspec` |
| Sinatra | `sinatra` in Gemfile | `rspec` |
| Hanami | `hanami` in Gemfile | `rspec` |

#### Backend Frameworks (Elixir)

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| Phoenix | `phoenix` in mix.exs | `phoenix`, `exunit` |
| Phoenix LiveView | `phoenix_live_view` in mix.exs | `phoenix`, `exunit` |

#### Backend Frameworks (Go)

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| Gin | `github.com/gin-gonic/gin` in go.mod | - |
| Echo | `github.com/labstack/echo` in go.mod | - |
| Fiber | `github.com/gofiber/fiber` in go.mod | - |
| Chi | `github.com/go-chi/chi` in go.mod | - |

#### Backend Frameworks (Rust)

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| Actix Web | `actix-web` in Cargo.toml | - |
| Axum | `axum` in Cargo.toml | - |
| Rocket | `rocket` in Cargo.toml | - |

#### Backend Frameworks (Java/Kotlin)

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| Spring Boot | `org.springframework.boot` in pom.xml or build.gradle | - |
| Quarkus | `io.quarkus` in pom.xml | - |
| Micronaut | `io.micronaut` in build.gradle | - |
| Ktor | `io.ktor` in build.gradle.kts | - |

#### Backend Frameworks (.NET)

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| ASP.NET Core | `Microsoft.AspNetCore` in .csproj | `xunit` |
| Blazor Server | `Microsoft.AspNetCore.Components.Server` in .csproj | `blazor`, `xunit` |
| Blazor WASM | `Microsoft.AspNetCore.Components.WebAssembly` in .csproj | `blazor`, `xunit` |

#### Backend Frameworks (PHP)

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| Laravel | `laravel/framework` in composer.json | - |
| Symfony | `symfony/framework-bundle` in composer.json | - |
| Slim | `slim/slim` in composer.json | - |

#### Mobile Frameworks

| Framework | Detection Method | Skills to Map |
|-----------|-----------------|---------------|
| Flutter | `pubspec.yaml` exists with flutter sdk | `flutter` |
| React Native | `react-native` in package.json | `react`, `jest` |
| Expo | `expo` in package.json | `react`, `jest` |
| Ionic | `@ionic/core` in package.json | `jest` |

### 1.3 Detect Infrastructure

Look for infrastructure patterns:

**Actions:**
- Check for `vercel.json`, `.vercel/` → Vercel deployment → `vercel` skill
- Check for `railway.json`, `railway.toml` → Railway deployment → `railway` skill
- Check for `fly.toml` → Fly.io deployment → `flyio` skill
- Check for `docker-compose.yml`, `Dockerfile` → Docker containerization
- Check for `.github/workflows/` → GitHub Actions CI/CD
- Check for `supabase/` → Supabase backend → `supabase` skill
- Check for `*.tf` files → Terraform infrastructure → `aws-cloud` skill (if AWS)
- Check for `cdk.json` → AWS CDK → `aws-cloud` skill
- Check for `serverless.yml` → Serverless Framework
- Check for `k8s/`, `kubernetes/`, `helm/` → Kubernetes → `kubernetes`, `helm` skills
- Check for `Chart.yaml` → Helm chart → `helm` skill

### 1.4 Identify Testing Frameworks

Detect test configuration for `quality_testing` category:

**Actions:**
- `jest.config.*` or `jest` in devDependencies → Jest testing
- `vitest.config.*` or `vitest` in devDependencies → Vitest testing
- `pytest.ini`, `conftest.py`, or pytest in deps → pytest
- `spec/` directory with `*_spec.rb` files → RSpec
- `.rspec` file → RSpec
- `test/` with `*_test.exs` files → ExUnit
- `playwright.config.*` → Playwright E2E
- `cypress.config.*` → Cypress E2E
- `*.test.ts`, `*.spec.ts` patterns → test files present

### 1.5 Detect Documentation Tools

Identify documentation tooling for `product_documentation` category:

**Actions:**
- `storybook` in devDependencies → Storybook component docs
- `@storybook/*` packages → Storybook
- `docusaurus.config.js` → Docusaurus documentation
- `typedoc.json` or `typedoc` in devDependencies → TypeDoc
- `swagger-jsdoc` or `@nestjs/swagger` → Swagger/OpenAPI docs
- `docs/` directory with markdown files → Documentation present
- `mkdocs.yml` → MkDocs documentation
- `sphinx` in requirements.txt → Sphinx documentation
- `ex_doc` in mix.exs → ExDoc (Elixir)
- `yard` in Gemfile → YARD documentation (Ruby)

### 1.6 Detect Git/CI Configuration

Identify CI/CD for `git_github` category:

**Actions:**
- `.github/workflows/*.yml` → GitHub Actions
- `.gitlab-ci.yml` → GitLab CI
- `bitbucket-pipelines.yml` → Bitbucket Pipelines
- `.circleci/config.yml` → CircleCI
- `Jenkinsfile` → Jenkins
- `.travis.yml` → Travis CI
- `azure-pipelines.yml` → Azure DevOps
- `.husky/` directory → Git hooks configured
- `commitlint.config.js` → Commit linting
- `.releaserc`, `release.config.js` → semantic-release
- `lefthook.yml` → Lefthook git hooks
- `pre-commit-config.yaml` → pre-commit framework

### 1.7 Detect Database Tools

Identify database tooling for `database` category:

**Actions:**
- `prisma` in dependencies or `prisma/schema.prisma` → Prisma ORM
- `drizzle-orm` in dependencies → Drizzle ORM
- `typeorm` in dependencies → TypeORM
- `sequelize` in dependencies → Sequelize ORM
- `pg` or `postgres` in dependencies → PostgreSQL client
- `mysql2` in dependencies → MySQL client
- `mongodb` or `mongoose` in dependencies → MongoDB
- `sqlalchemy` in requirements.txt → SQLAlchemy (Python)
- `activerecord` in Gemfile → ActiveRecord (Ruby)
- `ecto` in mix.exs → Ecto (Elixir)
- `migrations/` or `db/migrate/` directories → Database migrations present
- `knex` in dependencies → Knex.js query builder
- `supabase` in dependencies → Supabase client

### 1.8 Detect Metrics and Analytics Tools

Identify tooling for `metrics_analytics` category:

**Actions:**
- `@sentry/*` or `sentry` in dependencies → Sentry error tracking
- `datadog` packages → Datadog monitoring
- `newrelic` in dependencies → New Relic APM
- `prometheus-client` or `prom-client` → Prometheus metrics
- `opentelemetry` packages → OpenTelemetry tracing
- `mixpanel` or `amplitude` → Product analytics
- `grafana` configuration files → Grafana dashboards
- `.claude/metrics/` directory → Local metrics tracking

### 1.9 Detect Claude Code Integration

Identify Claude Code usage for `claude_code_help` category:

**Actions:**
- `.claude/` directory → Claude Code configured
- `CLAUDE.md` file → Claude instructions present
- `.claude/settings.json` → Claude settings configured
- `.claude-plugin/` directory → Claude plugin development
- `mcp.json` or MCP server configuration → MCP servers configured
- `hooks/` with Claude hooks → Custom hooks present

### 1.10 Discover Custom Agents (Optional)

Check for project-specific custom agents:

**Actions:**
- Scan `.claude/agents/*.yaml` or `.claude/agents/*.md` for agent definitions
- Extract agent name from filename or YAML frontmatter
- Extract description from YAML `description` field or first paragraph
- Extract tools from YAML `tools` field if present

**Example Agent File (`.claude/agents/my-custom-agent.yaml`):**
```yaml
---
name: my-custom-agent
description: Custom agent for project-specific automation
tools: [Read, Write, Bash]
---
Instructions for the custom agent...
```

**Output Structure:**
```json
{
  "custom_agents": {
    "my-custom-agent": {
      "description": "Custom agent for project-specific automation",
      "tools": ["Read", "Write", "Bash"],
      "triggers": ["my-custom", "custom agent"]
    }
  }
}
```

### 1.11 Discover Custom Skills (Optional)

Check for project-specific custom skills:

**Actions:**
- Scan `.claude/skills/` for skill directories or files
- Extract skill name from directory name or filename
- Look for `SKILL.md` or `README.md` for description
- Parse any YAML frontmatter for metadata

**Example Skill Directory:**
```
.claude/skills/
  my-custom-skill/
    SKILL.md
    config.yaml
```

**Output Structure:**
```json
{
  "skills": {
    "my-custom-skill": {
      "triggers": ["my-custom-skill", "custom skill"],
      "purpose": "Project-specific automation skill"
    }
  }
}
```

### 1.12 Identify File-Based Routing Patterns (Optional)

Analyze project structure to suggest file-pattern-based agent routing:

**Actions:**
- Identify distinct code areas (e.g., `src/app/api/`, `src/components/`, `tests/`)
- Map file patterns to appropriate agents based on content type
- Only include patterns where routing would differ from defaults

**Output Structure (use `custom_patterns`, NOT `routing_rules`):**
```json
{
  "custom_patterns": {
    "api_routes": {
      "file_patterns": ["src/app/api/**/*.ts", "src/routes/**/*.ts"],
      "agent": "backend-developer",
      "triggers": ["api", "endpoint", "route"]
    },
    "components": {
      "file_patterns": ["src/components/**/*.tsx"],
      "agent": "frontend-developer",
      "triggers": ["component", "UI"]
    },
    "tests": {
      "file_patterns": ["**/*.test.ts", "**/*.spec.ts"],
      "agent": "test-runner",
      "triggers": ["test", "spec"]
    }
  }
}
```

**Note:** This field is optional. Only include if the project has clear structural patterns that benefit from specialized routing.

## Phase 2: Rules Generation

### 2.1 Build Triggers Map

Based on detected technologies, build project-specific triggers for ALL relevant categories:

```json
{
  "triggers": {
    "product_documentation": ["<doc-tools>", "<api-doc-tools>"],
    "orchestration": ["<detected-orchestration-patterns>"],
    "development": ["<frameworks>", "<languages>", "<libraries>"],
    "quality_testing": ["<test-frameworks>", "<testing-tools>"],
    "infrastructure_build": ["<deployment-platform>", "<ci-cd-tool>", "<containerization>"],
    "git_github": ["<ci-platform>", "<git-hooks>", "<version-control-tools>"],
    "database": ["<orm>", "<database-client>", "<migration-tool>"],
    "metrics_analytics": ["<monitoring-tools>", "<analytics-platforms>"],
    "claude_code_help": ["<claude-integrations>"],
    "utility": ["<scaffolding-tools>", "<code-generators>"]
  }
}
```

**Rules:**
- Only include categories where technologies were detected
- Omit empty categories from the output
- Use lowercase trigger keywords
- Include both tool names and common action phrases

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

## Phase 2.5: Schema Validation

Before writing the rules file, validate the generated JSON against the schema.

### 2.5.1 Load Schema Reference

The project rules schema is located at:
- **Relative to this command**: `../lib/project-rules.schema.json`
- **In ensemble package**: `packages/router/lib/project-rules.schema.json`

### 2.5.2 Validation Requirements

**CRITICAL: Only generate properties defined in the schema.** Do not invent additional fields. Reference the schema at `../lib/project-rules.schema.json` for the complete list of allowed properties.

**Allowed top-level properties:**
- `version` (required) - semver format
- `generated` (required) - ISO-8601 timestamp
- `project_name` (required) - string
- `description` - optional string
- `source` - optional string
- `triggers` - category-to-keywords mapping
- `skill_mappings` - keyword-to-skills mapping
- `project_context` - project metadata
- `custom_agents` - project-specific agents
- `skills` - project-specific skills
- `agent_recommendations` - agent suggestions per category
- `custom_patterns` - file-pattern-based routing

**Do NOT generate:**
- Properties not listed above (e.g., `commands`, `routing_rules`, `scripts`)
- Synonyms for existing fields (use `custom_patterns`, not `routing_rules`)

**Category names in `triggers`** must be one of:
- `product_documentation`, `orchestration`, `development`, `quality_testing`
- `infrastructure_build`, `git_github`, `utility`, `database`
- `metrics_analytics`, `claude_code_help`

**Additional validation rules:**
1. **`skill_mappings`** values must be arrays of strings
2. **`version`** must match pattern `^\d+\.\d+\.\d+$`
3. **`generated`** must be ISO-8601 format
4. **`custom_patterns`** objects must have `file_patterns` (array), optional `agent` (string), optional `triggers` (array), optional `skills` (array)

### 2.5.3 Validation Action

**Before writing the file:**
- Read the schema from `../lib/project-rules.schema.json`
- Verify all required fields are present
- Verify `triggers` keys are valid category names
- Verify all arrays contain only strings
- If validation fails, report errors and do not write the file

## Phase 3: Generate Rules File

### 3.1 Assemble Project Rules

Create the project-specific rules structure:

```json
{
  "version": "1.0.0",
  "generated": "ISO-8601 timestamp",
  "project_name": "<detected-from-package.json-or-directory>",

  "triggers": {
    "product_documentation": ["storybook", "typedoc", "swagger"],
    "development": ["nextjs", "react", "typescript"],
    "quality_testing": ["jest", "playwright", "vitest"],
    "infrastructure_build": ["vercel", "github actions", "docker"],
    "git_github": ["github actions", "husky", "commitlint"],
    "database": ["prisma", "postgresql"],
    "metrics_analytics": ["sentry"]
  },

  "skill_mappings": {
    "nextjs": ["vercel", "react", "jest"],
    "react": ["jest"],
    "typescript": ["jest"],
    "prisma": [],
    "deploy": ["vercel"],
    "test": ["jest", "playwright-test"]
  },

  "project_context": {
    "primary_language": "TypeScript",
    "framework": "Next.js",
    "deployment": "Vercel",
    "testing": ["Jest", "Playwright"],
    "database": "PostgreSQL with Prisma",
    "monitoring": ["Sentry"],
    "documentation": ["Storybook", "TypeDoc"]
  }
}
```

**Note:** Only include categories where technologies were detected. The example above shows a well-instrumented project; simpler projects will have fewer categories.

### 3.2 Write Rules File

**Actions:**
- Validate output against `../lib/project-rules.schema.json` schema
- Create `.claude/` directory if it doesn't exist
- Write rules to `.claude/router-rules.json`
- Report summary of detected technologies
- Report validation status (PASS/FAIL)

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

For a Next.js project deployed on Vercel with comprehensive tooling:

```json
{
  "version": "1.0.0",
  "generated": "2025-12-28T12:00:00Z",
  "project_name": "my-nextjs-app",
  "triggers": {
    "product_documentation": ["storybook", "typedoc", "openapi", "swagger"],
    "development": ["nextjs", "next.js", "react", "typescript", "tsx"],
    "quality_testing": ["jest", "playwright", "vitest", "testing-library"],
    "infrastructure_build": ["vercel", "preview deployment", "edge function", "docker"],
    "git_github": ["github actions", "husky", "commitlint", "semantic-release"],
    "database": ["prisma", "postgresql", "prisma migrate"],
    "metrics_analytics": ["sentry", "vercel analytics"]
  },
  "skill_mappings": {
    "nextjs": ["vercel", "react", "jest"],
    "react": ["jest"],
    "typescript": ["jest"],
    "prisma": [],
    "deploy": ["vercel"],
    "test": ["jest", "playwright-test"]
  },
  "project_context": {
    "primary_language": "TypeScript",
    "framework": "Next.js 14",
    "deployment": "Vercel",
    "testing": ["Jest", "Playwright"],
    "database": "PostgreSQL with Prisma",
    "ci_cd": "GitHub Actions",
    "monitoring": ["Sentry", "Vercel Analytics"],
    "documentation": ["Storybook", "TypeDoc"]
  },
  "custom_agents": {
    "my-custom-agent": {
      "description": "Project-specific agent",
      "tools": ["Read", "Write"],
      "triggers": ["my-custom"]
    }
  },
  "skills": {
    "my-custom-skill": {
      "triggers": ["custom skill"],
      "purpose": "Project-specific skill"
    }
  },
  "custom_patterns": {
    "api_routes": {
      "file_patterns": ["src/app/api/**/*.ts"],
      "agent": "backend-developer",
      "triggers": ["api route", "endpoint"]
    },
    "tests": {
      "file_patterns": ["**/*.test.ts", "**/*.spec.ts"],
      "agent": "test-runner",
      "triggers": ["test", "spec"]
    }
  }
}
```

This comprehensive detection causes the router to:
- Recommend Vercel and Jest skills for deployment and testing mentions
- Route database queries to postgresql-specialist when Prisma is mentioned
- Suggest documentation-specialist for Storybook or TypeDoc tasks
- Route CI/CD questions to git-workflow or build-orchestrator agents
- Recommend Sentry-related debugging to appropriate monitoring agents

**Minimal Example** - For a simple Express.js API:

```json
{
  "version": "1.0.0",
  "generated": "2025-12-28T12:00:00Z",
  "project_name": "my-express-api",
  "triggers": {
    "development": ["express", "nodejs", "javascript"],
    "quality_testing": ["jest", "supertest"],
    "database": ["postgresql", "pg"]
  },
  "skill_mappings": {
    "express": ["jest"],
    "test": ["jest"]
  },
  "project_context": {
    "primary_language": "JavaScript",
    "framework": "Express.js",
    "testing": ["Jest"],
    "database": "PostgreSQL"
  }
}
```
