/**
 * Multi-Database Prisma Example
 *
 * This example demonstrates:
 * - Multiple database connections
 * - Read replicas
 * - Database-per-tenant multi-tenancy
 * - Cross-database queries
 * - Connection pooling strategies
 */

// =============================================================================
// Multiple Prisma Clients
// =============================================================================

import { PrismaClient as MainPrismaClient } from "@prisma/client";
import { PrismaClient as AnalyticsPrismaClient } from "@prisma/client/analytics";
import { PrismaClient as TenantPrismaClient } from "@prisma/client/tenant";

// =============================================================================
// lib/prisma-main.ts - Primary Database Client
// =============================================================================

const mainClientSingleton = () => {
  return new MainPrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });
};

declare global {
  var mainPrisma: ReturnType<typeof mainClientSingleton> | undefined;
}

export const mainPrisma = globalThis.mainPrisma ?? mainClientSingleton();

if (process.env.NODE_ENV !== "production") {
  globalThis.mainPrisma = mainPrisma;
}

// =============================================================================
// lib/prisma-analytics.ts - Analytics Database Client (Read Replica)
// =============================================================================

const analyticsClientSingleton = () => {
  return new AnalyticsPrismaClient({
    datasources: {
      db: {
        url: process.env.ANALYTICS_DATABASE_URL,
      },
    },
    log: ["error"],
  });
};

declare global {
  var analyticsPrisma: ReturnType<typeof analyticsClientSingleton> | undefined;
}

export const analyticsPrisma =
  globalThis.analyticsPrisma ?? analyticsClientSingleton();

if (process.env.NODE_ENV !== "production") {
  globalThis.analyticsPrisma = analyticsPrisma;
}

// =============================================================================
// Read Replica Pattern
// =============================================================================

interface PrismaWithReplica {
  write: MainPrismaClient;
  read: MainPrismaClient;
}

function createPrismaWithReplica(): PrismaWithReplica {
  const write = new MainPrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_URL },
    },
  });

  const read = new MainPrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_READ_REPLICA_URL ?? process.env.DATABASE_URL },
    },
  });

  return { write, read };
}

export const prismaReplica = createPrismaWithReplica();

// Usage example
export class UserServiceWithReplica {
  // Write operations go to primary
  async create(data: { email: string; name: string }) {
    return prismaReplica.write.user.create({ data });
  }

  async update(id: string, data: { name?: string }) {
    return prismaReplica.write.user.update({
      where: { id },
      data,
    });
  }

  // Read operations go to replica
  async findById(id: string) {
    return prismaReplica.read.user.findUnique({
      where: { id },
    });
  }

  async findAll(options?: { page?: number; pageSize?: number }) {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;

    return prismaReplica.read.user.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    });
  }

  // Heavy analytics queries go to replica
  async getStatistics() {
    return prismaReplica.read.user.groupBy({
      by: ["role"],
      _count: true,
      _max: { createdAt: true },
    });
  }
}

// =============================================================================
// Multi-Tenant: Database Per Tenant
// =============================================================================

// Tenant database URL mapping (could be from a config database)
const tenantDatabases: Record<string, string> = {
  "tenant-1": "postgresql://user:pass@host:5432/tenant_1",
  "tenant-2": "postgresql://user:pass@host:5432/tenant_2",
  "tenant-3": "postgresql://user:pass@host:5432/tenant_3",
};

// Cache of tenant Prisma clients
const tenantClients = new Map<string, TenantPrismaClient>();

export function getTenantPrisma(tenantId: string): TenantPrismaClient {
  // Return cached client if exists
  if (tenantClients.has(tenantId)) {
    return tenantClients.get(tenantId)!;
  }

  // Get database URL for tenant
  const databaseUrl = tenantDatabases[tenantId];
  if (!databaseUrl) {
    throw new Error(`Unknown tenant: ${tenantId}`);
  }

  // Create new client
  const client = new TenantPrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });

  // Cache and return
  tenantClients.set(tenantId, client);
  return client;
}

// Clean up tenant clients
export async function disconnectTenantClients() {
  const disconnects = Array.from(tenantClients.values()).map((client) =>
    client.$disconnect()
  );
  await Promise.all(disconnects);
  tenantClients.clear();
}

// Usage with middleware
export function createTenantMiddleware() {
  return async (req: any, res: any, next: any) => {
    const tenantId = req.headers["x-tenant-id"];

    if (!tenantId) {
      return res.status(400).json({ error: "Tenant ID required" });
    }

    try {
      req.prisma = getTenantPrisma(tenantId);
      next();
    } catch (error) {
      return res.status(400).json({ error: "Invalid tenant" });
    }
  };
}

// =============================================================================
// Multi-Tenant: Shared Database with Tenant Column
// =============================================================================

// Using Prisma extension for automatic tenant filtering
export function createTenantScopedPrisma(tenantId: string) {
  return mainPrisma.$extends({
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
        async findUnique({ model, args, query }) {
          // Add tenantId check after query
          const result = await query(args);
          if (result && (result as any).tenantId !== tenantId) {
            return null;
          }
          return result;
        },
        async create({ model, args, query }) {
          args.data = { ...args.data, tenantId };
          return query(args);
        },
        async createMany({ model, args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((item: any) => ({ ...item, tenantId }));
          } else {
            args.data = { ...args.data, tenantId };
          }
          return query(args);
        },
        async update({ model, args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async updateMany({ model, args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async delete({ model, args, query }) {
          // Verify tenant ownership before delete
          const existing = await (mainPrisma as any)[model].findFirst({
            where: { ...args.where, tenantId },
          });
          if (!existing) {
            throw new Error("Record not found or access denied");
          }
          return query(args);
        },
        async deleteMany({ model, args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async count({ model, args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },
    },
  });
}

// =============================================================================
// Cross-Database Queries
// =============================================================================

interface CrossDatabaseResult {
  user: any;
  analytics: any;
  tenant: any;
}

export async function getCrossDatabase(
  userId: string,
  tenantId: string
): Promise<CrossDatabaseResult> {
  // Parallel queries to different databases
  const [user, analytics] = await Promise.all([
    // Main database
    mainPrisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        posts: {
          take: 5,
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    // Analytics database
    analyticsPrisma.userAnalytics.findUnique({
      where: { userId },
      select: {
        totalPageViews: true,
        lastActiveAt: true,
        sessionCount: true,
      },
    }),
  ]);

  // Tenant-specific data
  const tenantPrisma = getTenantPrisma(tenantId);
  const tenantData = await tenantPrisma.tenantSettings.findFirst({
    where: { userId },
  });

  return {
    user,
    analytics,
    tenant: tenantData,
  };
}

// =============================================================================
// Connection Pooling Configuration
// =============================================================================

// For serverless environments (Vercel, AWS Lambda)
const serverlessClient = () => {
  return new MainPrismaClient({
    datasources: {
      db: {
        // Use connection pooler (PgBouncer, Supavisor)
        url: process.env.DATABASE_URL + "?pgbouncer=true&connection_limit=1",
      },
    },
  });
};

// For long-running servers
const serverClient = () => {
  return new MainPrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL + "?connection_limit=10&pool_timeout=10",
      },
    },
  });
};

// =============================================================================
// Database Health Checks
// =============================================================================

interface HealthStatus {
  database: string;
  status: "healthy" | "unhealthy";
  latency?: number;
  error?: string;
}

export async function checkDatabaseHealth(): Promise<HealthStatus[]> {
  const checks: Promise<HealthStatus>[] = [];

  // Main database
  checks.push(
    (async () => {
      const start = Date.now();
      try {
        await mainPrisma.$queryRaw`SELECT 1`;
        return {
          database: "main",
          status: "healthy" as const,
          latency: Date.now() - start,
        };
      } catch (error) {
        return {
          database: "main",
          status: "unhealthy" as const,
          error: (error as Error).message,
        };
      }
    })()
  );

  // Analytics database
  checks.push(
    (async () => {
      const start = Date.now();
      try {
        await analyticsPrisma.$queryRaw`SELECT 1`;
        return {
          database: "analytics",
          status: "healthy" as const,
          latency: Date.now() - start,
        };
      } catch (error) {
        return {
          database: "analytics",
          status: "unhealthy" as const,
          error: (error as Error).message,
        };
      }
    })()
  );

  // Tenant databases
  for (const [tenantId] of Object.entries(tenantDatabases)) {
    checks.push(
      (async () => {
        const start = Date.now();
        try {
          const client = getTenantPrisma(tenantId);
          await client.$queryRaw`SELECT 1`;
          return {
            database: `tenant-${tenantId}`,
            status: "healthy" as const,
            latency: Date.now() - start,
          };
        } catch (error) {
          return {
            database: `tenant-${tenantId}`,
            status: "unhealthy" as const,
            error: (error as Error).message,
          };
        }
      })()
    );
  }

  return Promise.all(checks);
}

// =============================================================================
// Graceful Shutdown
// =============================================================================

async function shutdown() {
  console.log("Shutting down database connections...");

  await Promise.all([
    mainPrisma.$disconnect(),
    analyticsPrisma.$disconnect(),
    prismaReplica.write.$disconnect(),
    prismaReplica.read.$disconnect(),
    disconnectTenantClients(),
  ]);

  console.log("All database connections closed");
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// =============================================================================
// Schema Examples for Multi-Database
// =============================================================================

/**
 * Main schema (prisma/schema.prisma):
 *
 * generator client {
 *   provider = "prisma-client-js"
 * }
 *
 * datasource db {
 *   provider = "postgresql"
 *   url      = env("DATABASE_URL")
 * }
 *
 * model User {
 *   id        String   @id @default(cuid())
 *   email     String   @unique
 *   tenantId  String   @map("tenant_id")
 *   // ... fields
 *   @@index([tenantId])
 * }
 */

/**
 * Analytics schema (prisma/analytics.prisma):
 *
 * generator client {
 *   provider = "prisma-client-js"
 *   output   = "../node_modules/@prisma/client/analytics"
 * }
 *
 * datasource db {
 *   provider = "postgresql"
 *   url      = env("ANALYTICS_DATABASE_URL")
 * }
 *
 * model UserAnalytics {
 *   id              String   @id @default(cuid())
 *   userId          String   @unique @map("user_id")
 *   totalPageViews  Int      @default(0) @map("total_page_views")
 *   sessionCount    Int      @default(0) @map("session_count")
 *   lastActiveAt    DateTime @map("last_active_at")
 * }
 */

/**
 * Tenant schema (prisma/tenant.prisma):
 *
 * generator client {
 *   provider = "prisma-client-js"
 *   output   = "../node_modules/@prisma/client/tenant"
 * }
 *
 * datasource db {
 *   provider = "postgresql"
 *   url      = env("TENANT_DATABASE_URL")
 * }
 *
 * model TenantSettings {
 *   id        String @id @default(cuid())
 *   userId    String @map("user_id")
 *   theme     String @default("light")
 *   locale    String @default("en")
 * }
 */

// =============================================================================
// Generate Multiple Clients
// =============================================================================

/**
 * Package.json scripts:
 *
 * {
 *   "scripts": {
 *     "prisma:generate": "prisma generate --schema=prisma/schema.prisma && prisma generate --schema=prisma/analytics.prisma && prisma generate --schema=prisma/tenant.prisma",
 *     "prisma:migrate:main": "prisma migrate deploy --schema=prisma/schema.prisma",
 *     "prisma:migrate:analytics": "prisma migrate deploy --schema=prisma/analytics.prisma",
 *     "prisma:migrate:all": "npm run prisma:migrate:main && npm run prisma:migrate:analytics"
 *   }
 * }
 */
