# Stack Detection Instructions

This document provides guidance for agentic technology stack detection during `/init-project`.

**Important**: Stack detection is an agentic LLM function - you explore, read, and reason about what you find. The tables below are REFERENCE MATERIAL for your reasoning, NOT checklists to follow mechanically.

---

## Agentic Detection Approach

### Philosophy

You are not executing a lookup algorithm. You are an intelligent agent that:
1. **Explores** the project structure to discover what exists
2. **Reads** files that might contain technology information
3. **Reasons** about what you find to understand the stack
4. **Infers** from available evidence when explicit signals are missing

### What to Look For

When exploring a project, consider these categories of evidence:

**Dependency/Manifest Files** (high-signal when present):
- Package managers: package.json, requirements.txt, pyproject.toml, Gemfile, go.mod, Cargo.toml, composer.json, mix.exs, pubspec.yaml, *.csproj, pom.xml, build.gradle
- These directly declare dependencies

**Configuration Files** (reveal frameworks and tools):
- Framework configs: next.config.*, vite.config.*, nuxt.config.*, angular.json
- Tool configs: tsconfig.json, jest.config.*, pytest.ini, .eslintrc
- Deployment configs: vercel.json, railway.json, Dockerfile, docker-compose.yml

**Directory Structure** (reveals architecture):
- `src/`, `lib/`, `app/` suggest different organizational patterns
- `pages/`, `app/` in JS projects suggest Next.js or similar
- `migrations/` suggests database usage
- `tests/`, `spec/`, `__tests__/` reveal testing patterns

**Source Code** (last resort, but valuable):
- Import statements reveal dependencies
- File extensions reveal languages
- Code patterns reveal frameworks even without config

**Documentation** (often describes intended stack):
- README.md, CONTRIBUTING.md, docs/
- Story or spec files describing features
- Architecture decision records

---

## Reference: Common Technology Signals

The following tables help you recognize common technologies. Use them as reference, not as exhaustive checklists.

### Languages (by file extension)
- `.js`, `.jsx`, `.ts`, `.tsx` - JavaScript/TypeScript
- `.py` - Python
- `.rb` - Ruby
- `.go` - Go
- `.rs` - Rust
- `.php` - PHP
- `.ex`, `.exs` - Elixir
- `.dart` - Dart
- `.cs` - C#
- `.java`, `.kt` - Java/Kotlin

### Frameworks (common indicators)
- React: `react` in deps, `.jsx`/`.tsx` files
- Next.js: `next` in deps, `pages/` or `app/` directory
- FastAPI: `fastapi` in deps, Python decorators `@app.get`
- Rails: `rails` gem, `config/routes.rb`, `app/models/`
- Phoenix: `phoenix` in mix.exs, `lib/*_web/`
- NestJS: `@nestjs/core` in deps, decorators `@Module`, `@Controller`
- Laravel: `laravel/framework` in composer.json, `artisan` file

### Testing (common indicators)
- Jest: `jest` in deps, `*.test.js` files
- pytest: `pytest` in deps, `test_*.py` files
- RSpec: `rspec` gem, `*_spec.rb` files
- Playwright: `@playwright/test` in deps, `*.spec.ts` files

### Databases (common indicators)
- Prisma: `prisma/schema.prisma` file
- PostgreSQL: `pg` or `psycopg2` in deps, `DATABASE_URL` patterns
- MongoDB: `mongodb` or `mongoose` in deps
- Redis: `redis` or `ioredis` in deps

---

## When Signals Are Missing

If you cannot find explicit dependency files or configs:

1. **Read source code**: Import statements and patterns reveal technologies
2. **Check documentation**: README often describes the intended stack
3. **Examine file structure**: Directory organization implies frameworks
4. **Look for stories/specs**: These may describe technologies before implementation
5. **Ask the user**: When uncertain, ask for clarification

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
