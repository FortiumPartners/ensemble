# Prisma ORM Comprehensive Reference

This document provides in-depth coverage of Prisma patterns, database integrations, and production deployment strategies.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Schema Design Patterns](#2-schema-design-patterns)
3. [Advanced Relations](#3-advanced-relations)
4. [Database Integrations](#4-database-integrations)
5. [Migration Workflows](#5-migration-workflows)
6. [Query Optimization](#6-query-optimization)
7. [Transactions & Concurrency](#7-transactions--concurrency)
8. [Middleware & Extensions](#8-middleware--extensions)
9. [Security & Row Level Security](#9-security--row-level-security)
10. [Production Deployment](#10-production-deployment)

---

## 1. Architecture Overview

### How Prisma Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Application                          │
├─────────────────────────────────────────────────────────────────┤
│                      Prisma Client (TS/JS)                       │
│  - Type-safe queries         - Generated from schema            │
│  - Auto-completion           - Relation handling                │
├─────────────────────────────────────────────────────────────────┤
│                       Query Engine (Rust)                        │
│  - Query optimization        - Connection pooling               │
│  - Query validation          - Transaction management           │
├─────────────────────────────────────────────────────────────────┤
│                          Database                                │
│  PostgreSQL | MySQL | SQLite | SQL Server | MongoDB             │
└─────────────────────────────────────────────────────────────────┘
```

### Prisma Components

| Component | Purpose | Location |
|-----------|---------|----------|
| **Prisma Schema** | Database model definition | `prisma/schema.prisma` |
| **Prisma Client** | Type-safe database client | `node_modules/.prisma/client` |
| **Prisma Migrate** | Database migrations | `prisma/migrations/` |
| **Prisma Studio** | Database GUI | CLI tool |
| **Query Engine** | Rust binary for queries | Downloaded on generate |

### Generation Flow

```bash
# 1. Define schema
# prisma/schema.prisma

# 2. Generate client
npx prisma generate
# - Reads schema.prisma
# - Downloads query engine
# - Generates TypeScript types
# - Creates client in node_modules/.prisma/client

# 3. Use in application
import { PrismaClient } from "@prisma/client"
```

---

## 2. Schema Design Patterns

### Soft Delete Pattern

```prisma
model User {
  id        String    @id @default(cuid())
  email     String    @unique
  name      String
  deletedAt DateTime?

  @@index([deletedAt])
}

model Post {
  id        String    @id @default(cuid())
  title     String
  authorId  String
  author    User      @relation(fields: [authorId], references: [id])
  deletedAt DateTime?

  @@index([authorId])
  @@index([deletedAt])
}
```

### Audit Fields Pattern

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String

  // Audit fields
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdBy String?
  updatedBy String?

  // Version for optimistic locking
  version   Int      @default(1)
}
```

### Multi-Tenant Pattern

```prisma
model Tenant {
  id        String   @id @default(cuid())
  name      String
  subdomain String   @unique
  users     User[]
  projects  Project[]
}

model User {
  id       String  @id @default(cuid())
  email    String
  tenant   Tenant  @relation(fields: [tenantId], references: [id])
  tenantId String

  // Unique within tenant
  @@unique([tenantId, email])
  @@index([tenantId])
}

model Project {
  id       String  @id @default(cuid())
  name     String
  tenant   Tenant  @relation(fields: [tenantId], references: [id])
  tenantId String

  @@index([tenantId])
}
```

### Polymorphic Pattern

```prisma
// Using discriminator field
model Comment {
  id            String   @id @default(cuid())
  content       String
  commentableId String
  commentableType String // "Post" | "Video" | "Image"
  createdAt     DateTime @default(now())

  @@index([commentableId, commentableType])
}

// Alternative: Separate relations
model Comment {
  id        String  @id @default(cuid())
  content   String
  post      Post?   @relation(fields: [postId], references: [id])
  postId    String?
  video     Video?  @relation(fields: [videoId], references: [id])
  videoId   String?

  @@index([postId])
  @@index([videoId])
}
```

### Tags/Labels Pattern

```prisma
model Post {
  id    String    @id @default(cuid())
  title String
  tags  PostTag[]
}

model Tag {
  id    String    @id @default(cuid())
  name  String    @unique
  slug  String    @unique
  posts PostTag[]
}

model PostTag {
  post   Post   @relation(fields: [postId], references: [id], onDelete: Cascade)
  postId String
  tag    Tag    @relation(fields: [tagId], references: [id], onDelete: Cascade)
  tagId  String

  @@id([postId, tagId])
}
```

### Enum Best Practices

```prisma
// Define enums for fixed value sets
enum OrderStatus {
  PENDING
  CONFIRMED
  PROCESSING
  SHIPPED
  DELIVERED
  CANCELLED
}

enum PaymentMethod {
  CREDIT_CARD
  DEBIT_CARD
  PAYPAL
  BANK_TRANSFER
  CRYPTO
}

model Order {
  id            String        @id @default(cuid())
  status        OrderStatus   @default(PENDING)
  paymentMethod PaymentMethod
}

// For PostgreSQL, you can also use native enums
// generator client {
//   previewFeatures = ["postgresqlExtensions"]
// }
```

---

## 3. Advanced Relations

### Composite Keys and Relations

```prisma
// Composite primary key
model OrderItem {
  orderId   String
  productId String
  quantity  Int
  price     Decimal

  order   Order   @relation(fields: [orderId], references: [id])
  product Product @relation(fields: [productId], references: [id])

  @@id([orderId, productId])
}

// Composite foreign key
model TenantUser {
  tenantId String
  userId   String
  role     String

  @@id([tenantId, userId])
}

model TenantUserSetting {
  tenantId String
  userId   String
  key      String
  value    String

  user TenantUser @relation(fields: [tenantId, userId], references: [tenantId, userId])

  @@id([tenantId, userId, key])
}
```

### Multiple Relations Between Same Models

```prisma
model User {
  id             String    @id @default(cuid())
  authoredPosts  Post[]    @relation("PostAuthor")
  reviewedPosts  Post[]    @relation("PostReviewer")
}

model Post {
  id         String  @id @default(cuid())
  title      String

  author     User    @relation("PostAuthor", fields: [authorId], references: [id])
  authorId   String

  reviewer   User?   @relation("PostReviewer", fields: [reviewerId], references: [id])
  reviewerId String?

  @@index([authorId])
  @@index([reviewerId])
}
```

### Self-Referential Tree

```prisma
model Category {
  id       String     @id @default(cuid())
  name     String
  path     String     @unique  // Materialized path: "/1/2/3"
  depth    Int        @default(0)

  parentId String?
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children Category[] @relation("CategoryTree")

  @@index([parentId])
  @@index([path])
}
```

```typescript
// Query entire subtree using path
const subtree = await prisma.category.findMany({
  where: {
    path: { startsWith: "/1/2/" },
  },
  orderBy: { path: "asc" },
});

// Get ancestors
const ancestors = await prisma.category.findMany({
  where: {
    path: {
      in: ["/1", "/1/2", "/1/2/3"],  // Parse from current path
    },
  },
});
```

### Relation Filters

```typescript
// Filter by relation existence
const usersWithPosts = await prisma.user.findMany({
  where: {
    posts: { some: {} },  // Has at least one post
  },
});

const usersWithoutPosts = await prisma.user.findMany({
  where: {
    posts: { none: {} },  // Has no posts
  },
});

const usersAllPublished = await prisma.user.findMany({
  where: {
    posts: { every: { published: true } },  // All posts published
  },
});

// Filter by nested relation
const usersWithPopularPosts = await prisma.user.findMany({
  where: {
    posts: {
      some: {
        comments: {
          some: {
            likes: { gte: 10 },
          },
        },
      },
    },
  },
});
```

---

## 4. Database Integrations

### Supabase Full Integration

```prisma
// prisma/schema.prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")       // Transaction pooler (port 6543)
  directUrl = env("DIRECT_URL")         // Direct connection (port 5432)
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

// Reference Supabase auth schema
model Profile {
  id        String   @id @db.Uuid      // Matches auth.users.id
  email     String   @unique
  username  String   @unique
  avatarUrl String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  posts Post[]
}
```

```typescript
// src/lib/prisma.ts - Supabase Prisma client
import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = globalThis.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query"] : [],
});

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

// src/lib/supabase.ts - Supabase client
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Create profile after Supabase auth signup
async function handleSignUp(user: User) {
  await prisma.profile.create({
    data: {
      id: user.id,  // Use Supabase auth user ID
      email: user.email!,
      username: user.email!.split("@")[0],
    },
  });
}
```

### Supabase Environment Variables

```bash
# .env
# Transaction pooler (for app queries)
DATABASE_URL="postgres://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# Direct connection (for migrations)
DIRECT_URL="postgres://postgres.[project-ref]:[password]@aws-0-[region].supabase.com:5432/postgres"

# Supabase client
NEXT_PUBLIC_SUPABASE_URL="https://[project-ref].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_ROLE_KEY="eyJ..."  # Server-side only, bypasses RLS
```

### Supabase Edge Functions with Prisma

```typescript
// supabase/functions/api/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { PrismaClient } from "../_shared/prisma-client/index.ts";

const prisma = new PrismaClient();

serve(async (req) => {
  try {
    const users = await prisma.user.findMany({
      take: 10,
    });

    return new Response(JSON.stringify(users), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
});
```

### PlanetScale Integration

```prisma
datasource db {
  provider     = "mysql"
  url          = env("DATABASE_URL")
  relationMode = "prisma"  // Required: PlanetScale doesn't support foreign keys
}
```

```typescript
// Handle referential integrity in application code
async function deleteUser(userId: string) {
  await prisma.$transaction([
    // Manually delete related records first
    prisma.post.deleteMany({ where: { authorId: userId } }),
    prisma.comment.deleteMany({ where: { authorId: userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}
```

### Neon Serverless

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

```typescript
// For serverless environments with connection pooling
import { Pool, neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaNeon(pool);
const prisma = new PrismaClient({ adapter });
```

### Multi-Database Setup

```prisma
// prisma/schema.prisma - Primary database
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// prisma/schema-analytics.prisma - Analytics database
datasource db {
  provider = "postgresql"
  url      = env("ANALYTICS_DATABASE_URL")
}
```

```typescript
// src/lib/prisma.ts
import { PrismaClient as MainPrisma } from "@prisma/client";
import { PrismaClient as AnalyticsPrisma } from "@prisma/analytics-client";

export const prisma = new MainPrisma();
export const analyticsPrisma = new AnalyticsPrisma();
```

```json
// package.json
{
  "scripts": {
    "prisma:generate": "prisma generate && prisma generate --schema=prisma/schema-analytics.prisma",
    "prisma:migrate": "prisma migrate deploy && prisma migrate deploy --schema=prisma/schema-analytics.prisma"
  }
}
```

---

## 5. Migration Workflows

### Development vs Production

| Scenario | Command | Effect |
|----------|---------|--------|
| Schema prototyping | `prisma db push` | Pushes schema directly, no migration |
| Create migration | `prisma migrate dev` | Creates SQL file, applies it |
| Preview migration | `prisma migrate dev --create-only` | Creates SQL without applying |
| Production deploy | `prisma migrate deploy` | Applies pending migrations |
| Reset dev database | `prisma migrate reset` | Drops DB, runs all migrations, seeds |

### Migration File Structure

```
prisma/
├── schema.prisma
└── migrations/
    ├── 20240101000000_init/
    │   └── migration.sql
    ├── 20240115000000_add_user_role/
    │   └── migration.sql
    └── migration_lock.toml
```

### Custom Migration Script

```sql
-- prisma/migrations/20240115000000_add_user_role/migration.sql

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'MODERATOR');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- Custom data migration
UPDATE "User" SET "role" = 'ADMIN' WHERE "email" LIKE '%@admin.com';
```

### Baseline Existing Database

```bash
# 1. Generate migration from current database
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql

# 2. Create migration directory
mkdir -p prisma/migrations/0_init

# 3. Mark as applied (database already has this schema)
npx prisma migrate resolve --applied 0_init
```

### CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - run: npm ci

      # Generate Prisma Client
      - run: npx prisma generate

      # Run migrations
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      # Deploy application
      - run: npm run deploy
```

### Supabase Migration Strategy

```bash
# Option 1: Use Prisma migrations with Supabase
# Local development
supabase start
DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres" npx prisma migrate dev

# Deploy to hosted Supabase
DIRECT_URL="postgres://..." npx prisma migrate deploy

# Option 2: Use Supabase Dashboard for auth-related changes
# Then pull changes to Prisma schema
npx prisma db pull
```

### Rollback Strategy

```bash
# Prisma doesn't have built-in rollback
# Options:

# 1. Create a new migration that reverses changes
npx prisma migrate dev --name rollback_feature_x

# 2. Manual rollback using custom script
psql $DATABASE_URL -f rollback.sql

# 3. Point-in-time recovery (if database supports it)
# Supabase, AWS RDS, etc. have PITR features
```

---

## 6. Query Optimization

### Efficient Data Loading

```typescript
// BAD: N+1 problem
const users = await prisma.user.findMany();
for (const user of users) {
  user.posts = await prisma.post.findMany({
    where: { authorId: user.id },
  });
}

// GOOD: Single query with include
const users = await prisma.user.findMany({
  include: { posts: true },
});

// BETTER: Select only needed fields
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true, title: true },
      where: { published: true },
      take: 5,
    },
  },
});
```

### Query Batching

```typescript
// Automatic batching with $transaction
const [users, posts, comments] = await prisma.$transaction([
  prisma.user.findMany(),
  prisma.post.findMany(),
  prisma.comment.findMany(),
]);

// Manual batching for loops
const userIds = ["1", "2", "3", "4", "5"];

// BAD: Multiple queries
for (const id of userIds) {
  await prisma.user.update({
    where: { id },
    data: { lastSeen: new Date() },
  });
}

// GOOD: Single updateMany or transaction
await prisma.user.updateMany({
  where: { id: { in: userIds } },
  data: { lastSeen: new Date() },
});
```

### Raw Queries for Complex Operations

```typescript
// Complex aggregation
const stats = await prisma.$queryRaw<{ month: Date; count: number }[]>`
  SELECT
    DATE_TRUNC('month', "createdAt") as month,
    COUNT(*) as count
  FROM "Post"
  WHERE "createdAt" >= ${startDate}
  GROUP BY DATE_TRUNC('month', "createdAt")
  ORDER BY month DESC
`;

// Full-text search (PostgreSQL)
const results = await prisma.$queryRaw<Post[]>`
  SELECT *
  FROM "Post"
  WHERE to_tsvector('english', title || ' ' || content)
        @@ plainto_tsquery('english', ${searchTerm})
  ORDER BY ts_rank(
    to_tsvector('english', title || ' ' || content),
    plainto_tsquery('english', ${searchTerm})
  ) DESC
  LIMIT 20
`;

// Bulk insert with ON CONFLICT
await prisma.$executeRaw`
  INSERT INTO "User" (id, email, name)
  VALUES ${Prisma.join(
    users.map(u => Prisma.sql`(${u.id}, ${u.email}, ${u.name})`)
  )}
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    "updatedAt" = NOW()
`;
```

### Index Optimization

```prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  slug      String
  authorId  String
  published Boolean  @default(false)
  createdAt DateTime @default(now())

  author User @relation(fields: [authorId], references: [id])

  // Single column indexes
  @@index([authorId])           // Foreign key
  @@index([published])          // Frequently filtered
  @@index([createdAt(sort: Desc)])  // Ordered queries

  // Composite indexes (column order matters!)
  @@index([authorId, published])    // Filter by author + published
  @@index([published, createdAt(sort: Desc)])  // Published posts by date

  // Unique constraint with multiple columns
  @@unique([authorId, slug])

  // Full-text index (PostgreSQL)
  @@index([title, content], type: Gin)
}
```

---

## 7. Transactions & Concurrency

### Interactive Transactions

```typescript
const transfer = await prisma.$transaction(async (tx) => {
  // Debit source account
  const source = await tx.account.update({
    where: { id: sourceId },
    data: { balance: { decrement: amount } },
  });

  if (source.balance < 0) {
    throw new Error("Insufficient funds");
  }

  // Credit destination account
  const destination = await tx.account.update({
    where: { id: destinationId },
    data: { balance: { increment: amount } },
  });

  // Create transaction record
  return tx.transaction.create({
    data: {
      sourceId,
      destinationId,
      amount,
      type: "TRANSFER",
    },
  });
}, {
  maxWait: 5000,
  timeout: 10000,
  isolationLevel: "Serializable",
});
```

### Optimistic Locking

```prisma
model Product {
  id      String @id @default(cuid())
  name    String
  stock   Int
  version Int    @default(1)
}
```

```typescript
async function updateStock(productId: string, quantity: number) {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) throw new Error("Product not found");

    try {
      return await prisma.product.update({
        where: {
          id: productId,
          version: product.version,  // Optimistic lock
        },
        data: {
          stock: product.stock - quantity,
          version: { increment: 1 },
        },
      });
    } catch (error) {
      if (error.code === "P2025") {
        // Record was modified, retry
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed after max retries");
}
```

### Database-Level Locking

```typescript
// FOR UPDATE lock (PostgreSQL)
const lockedUser = await prisma.$queryRaw<User[]>`
  SELECT * FROM "User"
  WHERE id = ${userId}
  FOR UPDATE
`;

// Wrapped in transaction
await prisma.$transaction(async (tx) => {
  const [user] = await tx.$queryRaw<User[]>`
    SELECT * FROM "User"
    WHERE id = ${userId}
    FOR UPDATE NOWAIT
  `;

  await tx.user.update({
    where: { id: userId },
    data: { balance: user.balance - amount },
  });
});
```

---

## 8. Middleware & Extensions

### Client Extensions (Prisma 4.16+)

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient().$extends({
  // Add custom methods to models
  model: {
    user: {
      async findByEmail(email: string) {
        return prisma.user.findUnique({ where: { email } });
      },
      async softDelete(id: string) {
        return prisma.user.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
      },
    },
  },

  // Modify query behavior
  query: {
    user: {
      async findMany({ model, operation, args, query }) {
        // Auto-filter soft-deleted
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
    },
  },

  // Add computed fields
  result: {
    user: {
      fullName: {
        needs: { firstName: true, lastName: true },
        compute(user) {
          return `${user.firstName} ${user.lastName}`;
        },
      },
    },
  },
});

// Usage
const user = await prisma.user.findByEmail("test@example.com");
console.log(user?.fullName);  // Computed field
```

### Audit Logging Extension

```typescript
const prismaWithAudit = prisma.$extends({
  query: {
    $allModels: {
      async create({ model, operation, args, query }) {
        const result = await query(args);

        await prisma.auditLog.create({
          data: {
            model: model as string,
            operation: "CREATE",
            recordId: (result as any).id,
            newData: JSON.stringify(args.data),
            userId: getCurrentUserId(),
          },
        });

        return result;
      },

      async update({ model, operation, args, query }) {
        // Get old data first
        const oldRecord = await (prisma as any)[model].findUnique({
          where: args.where,
        });

        const result = await query(args);

        await prisma.auditLog.create({
          data: {
            model: model as string,
            operation: "UPDATE",
            recordId: (result as any).id,
            oldData: JSON.stringify(oldRecord),
            newData: JSON.stringify(args.data),
            userId: getCurrentUserId(),
          },
        });

        return result;
      },

      async delete({ model, operation, args, query }) {
        const oldRecord = await (prisma as any)[model].findUnique({
          where: args.where,
        });

        const result = await query(args);

        await prisma.auditLog.create({
          data: {
            model: model as string,
            operation: "DELETE",
            recordId: (oldRecord as any).id,
            oldData: JSON.stringify(oldRecord),
            userId: getCurrentUserId(),
          },
        });

        return result;
      },
    },
  },
});
```

### Multi-Tenant Extension

```typescript
function createTenantPrisma(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findFirst({ model, args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async create({ model, args, query }) {
          args.data = { ...args.data, tenantId };
          return query(args);
        },
        async update({ model, args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async delete({ model, args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },
    },
  });
}

// Usage per request
const tenantPrisma = createTenantPrisma(req.tenantId);
const users = await tenantPrisma.user.findMany();  // Auto-filtered by tenant
```

---

## 9. Security & Row Level Security

### Supabase RLS with Prisma

```sql
-- Create RLS policies in Supabase SQL Editor
-- prisma/migrations/custom/rls_policies.sql

-- Enable RLS on table
ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read published posts
CREATE POLICY "Public can read published posts"
ON "Post" FOR SELECT
USING (published = true);

-- Policy: Users can only modify their own posts
CREATE POLICY "Users can modify own posts"
ON "Post" FOR ALL
USING (auth.uid()::text = "authorId")
WITH CHECK (auth.uid()::text = "authorId");

-- Policy: Admins can do anything
CREATE POLICY "Admins have full access"
ON "Post" FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "Profile"
    WHERE id = auth.uid()::text
    AND role = 'ADMIN'
  )
);
```

### Bypassing RLS with Service Role

```typescript
// Server-side: Use service role to bypass RLS
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

// Supabase client with service role (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Prisma uses direct database connection (bypasses RLS by default)
const prisma = new PrismaClient();

// For Prisma to respect RLS, set role in transaction
async function queryWithRLS(userId: string) {
  return prisma.$transaction(async (tx) => {
    // Set the user context for RLS
    await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;

    // Now queries respect RLS
    return tx.post.findMany();
  });
}
```

### Application-Level Security

```typescript
// Middleware to enforce access control
const prismaWithAuth = prisma.$extends({
  query: {
    post: {
      async findMany({ args, query }) {
        const userId = getCurrentUserId();

        if (!userId) {
          // Public: only published posts
          args.where = { ...args.where, published: true };
        } else if (!isAdmin()) {
          // User: own posts or published
          args.where = {
            ...args.where,
            OR: [
              { authorId: userId },
              { published: true },
            ],
          };
        }
        // Admin: no filter

        return query(args);
      },

      async update({ args, query }) {
        const userId = getCurrentUserId();
        const post = await prisma.post.findUnique({
          where: args.where,
        });

        if (!post) throw new NotFoundError();
        if (post.authorId !== userId && !isAdmin()) {
          throw new ForbiddenError();
        }

        return query(args);
      },
    },
  },
});
```

---

## 10. Production Deployment

### Connection Pooling

```typescript
// PrismaClient with connection pool configuration
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Connection pool is managed by Prisma Query Engine
// Configure in connection string:
// ?connection_limit=5&pool_timeout=10

// For serverless (Supabase, Neon):
// Use transaction pooler URL for queries
// Use direct URL for migrations
```

### Serverless Optimization

```typescript
// Cold start optimization
import { PrismaClient } from "@prisma/client";

// Reuse client across invocations
let prisma: PrismaClient;

export function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: ["error"],
    });
  }
  return prisma;
}

// Connection management for serverless
export async function handler(event: any) {
  const prisma = getPrisma();

  try {
    const result = await prisma.user.findMany();
    return { statusCode: 200, body: JSON.stringify(result) };
  } finally {
    // Don't disconnect in serverless - reuse connection
  }
}
```

### Health Check Endpoint

```typescript
// Health check with database ping
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      database: "disconnected",
      error: error.message,
    });
  }
});
```

### Monitoring and Logging

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: [
    { level: "query", emit: "event" },
    { level: "error", emit: "event" },
    { level: "warn", emit: "event" },
  ],
});

// Log slow queries
prisma.$on("query", (e) => {
  if (e.duration > 100) {  // > 100ms
    console.warn("Slow query:", {
      query: e.query,
      duration: e.duration,
      params: e.params,
    });
  }
});

// Send errors to monitoring
prisma.$on("error", (e) => {
  console.error("Prisma error:", e);
  // sendToSentry(e);
});
```

### Docker Configuration

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

# Copy generated Prisma client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

RUN npm ci --production

CMD ["node", "dist/main.js"]
```

---

## Summary

This reference covers advanced Prisma patterns for production applications:

- **Schema Design**: Soft deletes, auditing, multi-tenancy, polymorphism
- **Database Integrations**: Supabase, PlanetScale, Neon with specific configurations
- **Migrations**: Development, production, CI/CD, and rollback strategies
- **Optimization**: Query batching, raw SQL, index design
- **Security**: RLS integration, application-level access control
- **Production**: Connection pooling, serverless, monitoring

For quick patterns, see [SKILL.md](./SKILL.md). For library-specific details, use Context7 MCP with `/prisma/prisma`.

---

**Version**: 1.0.0 | **Last Updated**: 2025-01-01 | **Status**: Production Ready
