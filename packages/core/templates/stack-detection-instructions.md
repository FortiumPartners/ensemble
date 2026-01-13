# Stack Detection Instructions

This document provides instructions for the LLM to detect the project's technology stack during `/init-project`.

**Important**: Stack detection is an LLM function, NOT executable code. The LLM reads project files and analyzes them to determine the technology stack.

---

## Detection Process

### Step 1: Scan Dependency Files

Scan the project root for the following files and extract technology information:

| File | Detection Logic |
|------|-----------------|
| `package.json` | Node.js project; extract `dependencies` and `devDependencies` for frameworks |
| `requirements.txt` | Python project; scan for framework packages |
| `pyproject.toml` | Python project; check `[project.dependencies]` or `[tool.poetry.dependencies]` |
| `Pipfile` | Python project; check `[packages]` section |
| `Gemfile` | Ruby project; scan for Rails, Sinatra, etc. |
| `go.mod` | Go project; extract module dependencies |
| `Cargo.toml` | Rust project; check `[dependencies]` |
| `composer.json` | PHP project; check `require` section |
| `pom.xml` | Java/Maven project |
| `build.gradle` | Java/Gradle project |
| `*.csproj`, `*.sln` | .NET project |
| `mix.exs` | Elixir project |
| `pubspec.yaml` | Dart/Flutter project |

### Step 2: Identify Frameworks

For each language detected, identify the primary framework:

#### JavaScript/TypeScript
| Pattern in package.json | Framework |
|-------------------------|-----------|
| `react`, `react-dom` | React |
| `next` | Next.js |
| `vue` | Vue.js |
| `nuxt` | Nuxt.js |
| `@angular/core` | Angular |
| `svelte` | Svelte |
| `express` | Express.js |
| `fastify` | Fastify |
| `@nestjs/core` | NestJS |
| `hono` | Hono |

#### Python
| Pattern | Framework |
|---------|-----------|
| `django` | Django |
| `flask` | Flask |
| `fastapi` | FastAPI |
| `starlette` | Starlette |
| `tornado` | Tornado |
| `celery` | Celery (background jobs) |

#### Ruby
| Pattern | Framework |
|---------|-----------|
| `rails` | Ruby on Rails |
| `sinatra` | Sinatra |
| `hanami` | Hanami |

#### Other Languages
| Pattern | Stack |
|---------|-------|
| `gin-gonic/gin` (go.mod) | Go/Gin |
| `actix-web` (Cargo.toml) | Rust/Actix |
| `phoenix` (mix.exs) | Elixir/Phoenix |
| `laravel/framework` (composer.json) | PHP/Laravel |

### Step 3: Detect Testing Setup

Scan for test configuration:

| File/Pattern | Testing Framework |
|--------------|-------------------|
| `jest.config.*` | Jest |
| `vitest.config.*` | Vitest |
| `cypress.config.*` | Cypress |
| `playwright.config.*` | Playwright |
| `pytest.ini`, `pyproject.toml [tool.pytest]` | pytest |
| `.rspec` | RSpec |
| `*_test.go` files | Go testing |
| `tests/` directory with `*Test.php` | PHPUnit |

### Step 4: Detect Database

Look for database configuration:

| Pattern | Database |
|---------|----------|
| `prisma/schema.prisma` | PostgreSQL/MySQL (via Prisma) |
| `drizzle.config.*` | PostgreSQL/MySQL (via Drizzle) |
| `POSTGRES`, `pg` in deps | PostgreSQL |
| `mysql2` in deps | MySQL |
| `mongodb` in deps | MongoDB |
| `redis` in deps | Redis |
| `supabase` in deps | Supabase |
| `@planetscale/database` in deps | PlanetScale |

### Step 5: Detect Infrastructure

| Pattern | Infrastructure |
|---------|----------------|
| `Dockerfile` | Docker |
| `docker-compose.yml` | Docker Compose |
| `vercel.json` | Vercel |
| `railway.json` | Railway |
| `.github/workflows/` | GitHub Actions |
| `netlify.toml` | Netlify |
| `serverless.yml` | Serverless Framework |
| `terraform/`, `*.tf` | Terraform |

---

## Output Format

After detection, produce a summary in this format:

```markdown
## Detected Stack

**Primary Language**: [language]
**Framework**: [framework]
**Runtime**: [Node.js version, Python version, etc.]

**Testing**:
- Unit: [framework]
- Integration: [framework]
- E2E: [framework]

**Database**: [database]
**ORM/Query Builder**: [tool]

**Infrastructure**:
- Hosting: [platform]
- CI/CD: [platform]
- Containerization: [tool]

**Additional Tools**:
- [tool 1]
- [tool 2]
```

---

## Confidence Levels

For each detection, assess confidence:

| Confidence | Criteria |
|------------|----------|
| High (>90%) | Explicit dependency with version |
| Medium (70-90%) | File patterns, directory structure |
| Low (<70%) | Inferred from code patterns |

When confidence is low, prompt the user for confirmation.

---

## Edge Cases

1. **Monorepo**: Scan all workspace directories
2. **Multi-language**: List all detected stacks
3. **No clear framework**: Report language only, suggest common frameworks
4. **Conflicting signals**: Ask user to clarify

---

*This document guides the LLM during /init-project stack detection. It is NOT executable code.*
