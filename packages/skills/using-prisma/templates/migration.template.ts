/**
 * Custom Migration Runner Template
 *
 * Template Variables:
 *   migration_name: Name of the migration
 *   run_before_prisma: boolean - Run before prisma migrate
 *   run_after_prisma: boolean - Run after prisma migrate
 *   sql_up: SQL to execute on migrate
 *   sql_down: SQL to execute on rollback
 *   requires_confirmation: boolean - Prompt before destructive operations
 *
 * Output: prisma/custom-migrations/{{ migration_name }}.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// =============================================================================
// Migration Metadata
// =============================================================================

export const migrationMeta = {
  name: "{{ migration_name }}",
  description: "{{ description | default('Custom migration') }}",
  runBefore: {{ run_before_prisma | default(false) | lower }},
  runAfter: {{ run_after_prisma | default(true) | lower }},
  requiresConfirmation: {{ requires_confirmation | default(false) | lower }},
  createdAt: "{{ created_at | default('2025-01-01') }}",
};

// =============================================================================
// Up Migration
// =============================================================================

export async function up(): Promise<void> {
  console.log(`🔼 Running migration: ${migrationMeta.name}`);

  {% if sql_up %}
  // Raw SQL migration
  await prisma.$executeRawUnsafe(`
    {{ sql_up }}
  `);
  {% else %}
  // TypeScript migration logic
  // TODO: Implement up migration

  // Example: Add a new column with data migration
  /*
  await prisma.$executeRaw`
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
  `;

  // Migrate existing data
  const users = await prisma.user.findMany();
  await prisma.$transaction(
    users.map((user) =>
      prisma.user.update({
        where: { id: user.id },
        data: { displayName: user.name },
      })
    )
  );
  */

  // Example: Create index
  /*
  await prisma.$executeRaw`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_email" ON "User" ("email");
  `;
  */

  // Example: Create enum
  /*
  await prisma.$executeRaw`
    DO $$ BEGIN
      CREATE TYPE "Status" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `;
  */
  {% endif %}

  console.log(`✅ Migration ${migrationMeta.name} completed`);
}

// =============================================================================
// Down Migration (Rollback)
// =============================================================================

export async function down(): Promise<void> {
  console.log(`🔽 Rolling back migration: ${migrationMeta.name}`);

  {% if sql_down %}
  // Raw SQL rollback
  await prisma.$executeRawUnsafe(`
    {{ sql_down }}
  `);
  {% else %}
  // TypeScript rollback logic
  // TODO: Implement down migration

  // Example: Remove column
  /*
  await prisma.$executeRaw`
    ALTER TABLE "User" DROP COLUMN IF EXISTS "displayName";
  `;
  */

  // Example: Drop index
  /*
  await prisma.$executeRaw`
    DROP INDEX IF EXISTS "idx_user_email";
  `;
  */
  {% endif %}

  console.log(`✅ Rollback ${migrationMeta.name} completed`);
}

// =============================================================================
// Data Validation
// =============================================================================

export async function validate(): Promise<boolean> {
  console.log(`🔍 Validating migration: ${migrationMeta.name}`);

  try {
    // TODO: Add validation checks

    // Example: Check data integrity
    /*
    const invalidRecords = await prisma.user.count({
      where: {
        displayName: null,
        name: { not: null },
      },
    });

    if (invalidRecords > 0) {
      console.warn(`⚠️  Found ${invalidRecords} records with missing displayName`);
      return false;
    }
    */

    console.log("✅ Validation passed");
    return true;
  } catch (error) {
    console.error("❌ Validation failed:", error);
    return false;
  }
}

// =============================================================================
// CLI Runner
// =============================================================================

async function main() {
  const command = process.argv[2];

  try {
    switch (command) {
      case "up":
        await up();
        break;
      case "down":
        await down();
        break;
      case "validate":
        const isValid = await validate();
        process.exit(isValid ? 0 : 1);
        break;
      default:
        console.log("Usage: npx ts-node migration.ts [up|down|validate]");
        process.exit(1);
    }
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

// =============================================================================
// Migration Runner Integration
// =============================================================================

/**
 * Custom migration runner that integrates with Prisma migrations
 *
 * Usage in CI/CD:
 *
 * 1. Run pre-Prisma migrations:
 *    find prisma/custom-migrations -name "*.ts" -exec grep -l "runBefore: true" {} \; | xargs -I {} npx ts-node {} up
 *
 * 2. Run Prisma migrations:
 *    npx prisma migrate deploy
 *
 * 3. Run post-Prisma migrations:
 *    find prisma/custom-migrations -name "*.ts" -exec grep -l "runAfter: true" {} \; | xargs -I {} npx ts-node {} up
 *
 * 4. Validate all:
 *    find prisma/custom-migrations -name "*.ts" | xargs -I {} npx ts-node {} validate
 */
