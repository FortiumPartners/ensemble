# Prisma ORM Development Skill

Type-safe database access with schema-first design, migrations, and multi-database support.

## Overview

This skill provides comprehensive guidance for Prisma ORM development with a focus on:

- **Schema Design** - Models, relations, indexes, and constraints
- **Database Integrations** - Supabase, PlanetScale, Neon, Railway, PostgreSQL
- **Migrations** - Development workflows, production deployment, CI/CD
- **Type Safety** - Generated types, client patterns, type utilities
- **Testing** - Mock client, test database strategies

## Skill Structure

```
skills/prisma/
├── SKILL.md                 # Quick reference (~900 lines)
├── REFERENCE.md             # Comprehensive guide (~1800 lines)
├── VALIDATION.md            # Feature parity tracking
├── README.md                # This file
├── templates/
│   ├── schema.template.prisma
│   ├── model.template.prisma
│   ├── migration.template.ts
│   ├── seed.template.ts
│   ├── client.template.ts
│   ├── repository.template.ts
│   ├── supabase_schema.template.prisma
│   └── rls_migration.template.sql
└── examples/
    ├── schema_patterns.example.prisma
    ├── nestjs_prisma.example.ts
    ├── supabase_integration.example.ts
    └── multi_database.example.ts
```

## Quick Start

### For Common Tasks

Use **SKILL.md** for:
- Schema design patterns
- Model and relation definitions
- CLI commands (generate, migrate, db push)
- Client query patterns
- Supabase connection setup

### For Deep Understanding

Use **REFERENCE.md** for:
- Complete migration workflows
- Database-specific configurations
- Advanced relation patterns
- Row Level Security with Prisma
- Production deployment strategies

### For Code Generation

Use **templates/** when creating:
- New Prisma schemas
- Model definitions with relations
- Database seeding scripts
- Repository pattern wrappers
- Supabase-specific configurations

### For Architecture Reference

Use **examples/** to understand:
- Complex schema patterns
- NestJS + Prisma integration
- Supabase full integration
- Multi-database setups

## Database Integrations

| Database | Support Level | Key Features |
|----------|---------------|--------------|
| **Supabase** | Full | Pooling, RLS, Edge Functions, Auth integration |
| **PostgreSQL** | Full | Extensions, schemas, full-text search |
| **PlanetScale** | Full | Serverless MySQL, referential integrity |
| **Neon** | Full | Serverless PostgreSQL, branching |
| **Railway** | Full | Easy deployment, environment management |
| **MySQL** | Full | Standard MySQL patterns |
| **SQLite** | Full | Local development, embedded |
| **SQL Server** | Full | Enterprise patterns |
| **MongoDB** | Full | Document patterns (different syntax) |

## Context7 Integration

This skill documents common patterns. For edge cases:

| When to Use Context7 | Library ID |
|---------------------|------------|
| Advanced Prisma features | `/prisma/prisma` |
| Supabase specifics | `/supabase/supabase-js` |
| PostgreSQL optimization | `/postgres/postgres` |

### Example Context7 Query

```typescript
// When skill patterns aren't sufficient:
// 1. Resolve library
mcp__context7__resolve_library_id(
    libraryName="prisma",
    query="composite type with JSON field"
)

// 2. Query docs
mcp__context7__query_docs(
    libraryId="/prisma/prisma",
    query="how to use Json field with typing"
)
```

## Coverage Summary

| Category | Coverage | Notes |
|----------|----------|-------|
| Schema Design | 95% | Models, relations, attributes |
| Client Queries | 90% | CRUD, filtering, pagination |
| Migrations | 90% | Dev, prod, CI/CD workflows |
| Supabase | 85% | Connection, RLS, Edge Functions |
| Transactions | 90% | Interactive, sequential, nested |
| Testing | 85% | Mock client, test database |

See [VALIDATION.md](./VALIDATION.md) for detailed coverage matrix.

## Key Patterns

### Schema Definition

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([email])
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String

  @@index([authorId])
}
```

### Supabase Connection

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")        // Pooled for app
  directUrl = env("DIRECT_URL")          // Direct for migrations
}
```

### Type-Safe Query

```typescript
const user = await prisma.user.findUnique({
  where: { email: "user@example.com" },
  include: {
    posts: {
      where: { published: true },
      orderBy: { createdAt: "desc" },
    },
  },
});
// user is fully typed with posts relation
```

## Requirements

- Node.js 18+
- TypeScript 5.0+
- Prisma 5.0+
- Database (PostgreSQL, MySQL, SQLite, etc.)

## Related Skills

- **NestJS** - Backend framework integration (`packages/nestjs/`)
- **Jest** - Testing patterns (`packages/jest/`)
- **PostgreSQL** - Database optimization (`postgresql-specialist` agent)
- **Supabase** - Platform integration (supabase skill)

## Maintenance

When updating this skill:

1. Update patterns in SKILL.md or REFERENCE.md
2. Ensure templates reflect Prisma 5.x best practices
3. Update VALIDATION.md coverage matrix
4. Test examples with latest Prisma version
5. Verify Supabase integration patterns

## Version

- **Skill Version**: 1.0.0
- **Target Prisma**: 5.0+
- **Target TypeScript**: 5.0+
- **Target Node.js**: 18+

---

**Status**: Production Ready | **Coverage**: 90%
