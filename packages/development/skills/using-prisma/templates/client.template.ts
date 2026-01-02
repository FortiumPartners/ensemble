/**
 * Prisma Client Singleton Template
 *
 * Template Variables:
 *   log_levels: Array of log levels ["query", "error", "warn"]
 *   singleton: boolean - Use global singleton pattern
 *   extensions: Array of extensions to apply
 *
 * Output: src/lib/prisma.ts
 */
import { PrismaClient{% if extensions %}, Prisma{% endif %} } from "@prisma/client";

// =============================================================================
// Type Declarations
// =============================================================================

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// =============================================================================
// Client Configuration
// =============================================================================

const prismaClientOptions: Prisma.PrismaClientOptions = {
  log:
    process.env.NODE_ENV === "development"
      ? [
          {% for level in log_levels | default(['query', 'error', 'warn']) %}
          { level: "{{ level }}", emit: "event" },
          {% endfor %}
        ]
      : [{ level: "error", emit: "event" }],
};

// =============================================================================
// Client Instance
// =============================================================================

{% if singleton | default(true) %}
const prismaBase = globalThis.prisma ?? new PrismaClient(prismaClientOptions);

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prismaBase;
}
{% else %}
const prismaBase = new PrismaClient(prismaClientOptions);
{% endif %}

// =============================================================================
// Extensions
// =============================================================================

{% if 'softDelete' in extensions | default([]) %}
// Soft Delete Extension
const withSoftDelete = prismaBase.$extends({
  query: {
    $allModels: {
      async findMany({ model, args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
      async findFirst({ model, args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
      async findUnique({ model, args, query }) {
        const result = await query(args);
        if (result && (result as any).deletedAt !== null) {
          return null;
        }
        return result;
      },
      async count({ model, args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
    },
  },
  model: {
    $allModels: {
      async softDelete<T>(this: T, where: Prisma.Args<T, "update">["where"]) {
        const context = Prisma.getExtensionContext(this);
        return (context as any).update({
          where,
          data: { deletedAt: new Date() },
        });
      },
      async restore<T>(this: T, where: Prisma.Args<T, "update">["where"]) {
        const context = Prisma.getExtensionContext(this);
        return (context as any).update({
          where,
          data: { deletedAt: null },
        });
      },
    },
  },
});
{% endif %}

{% if 'audit' in extensions | default([]) %}
// Audit Logging Extension
function getCurrentUserId(): string | null {
  // TODO: Implement based on your auth system
  // e.g., return AsyncLocalStorage context
  return null;
}

const withAudit = prismaBase.$extends({
  query: {
    $allModels: {
      async create({ model, args, query }) {
        const result = await query(args);
        console.log(`[AUDIT] ${model}.create`, {
          recordId: (result as any).id,
          userId: getCurrentUserId(),
          data: args.data,
        });
        return result;
      },
      async update({ model, args, query }) {
        const result = await query(args);
        console.log(`[AUDIT] ${model}.update`, {
          recordId: (result as any).id,
          userId: getCurrentUserId(),
          where: args.where,
          data: args.data,
        });
        return result;
      },
      async delete({ model, args, query }) {
        const result = await query(args);
        console.log(`[AUDIT] ${model}.delete`, {
          recordId: (result as any).id,
          userId: getCurrentUserId(),
        });
        return result;
      },
    },
  },
});
{% endif %}

// =============================================================================
// Logging
// =============================================================================

{% if 'query' in log_levels | default([]) %}
prismaBase.$on("query", (e) => {
  if (e.duration > 100) {
    console.warn("[Prisma] Slow query:", {
      query: e.query,
      params: e.params,
      duration: `${e.duration}ms`,
    });
  }
});
{% endif %}

prismaBase.$on("error", (e) => {
  console.error("[Prisma] Error:", e);
});

// =============================================================================
// Export
// =============================================================================

{% if extensions %}
// Apply extensions in order
export const prisma = prismaBase
  {% if 'softDelete' in extensions %}.$extends(withSoftDelete){% endif %}
  {% if 'audit' in extensions %}.$extends(withAudit){% endif %};
{% else %}
export const prisma = prismaBase;
{% endif %}

export default prisma;

// =============================================================================
// Types
// =============================================================================

export type { Prisma } from "@prisma/client";
