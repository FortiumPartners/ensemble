/**
 * Database Seeding Template
 *
 * Template Variables:
 *   models_to_seed: Array of model names to seed
 *   use_factories: boolean - Use factory functions
 *   clear_before_seed: boolean - Truncate tables first
 *   seed_counts: Object mapping model to count { User: 10, Post: 50 }
 *
 * Output: prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";
{% if use_factories %}
import { faker } from "@faker-js/faker";
{% endif %}

const prisma = new PrismaClient();

// =============================================================================
// Configuration
// =============================================================================

const SEED_CONFIG = {
  {% for model in models_to_seed %}
  {{ model }}: {{ seed_counts[model] | default(10) }},
  {% endfor %}
};

// =============================================================================
// Factory Functions
// =============================================================================

{% if use_factories %}
{% for model in models_to_seed %}
function create{{ model }}Data(overrides: Partial<any> = {}) {
  return {
    {% if model == 'User' %}
    email: faker.internet.email(),
    name: faker.person.fullName(),
    {% elif model == 'Post' %}
    title: faker.lorem.sentence(),
    content: faker.lorem.paragraphs(3),
    slug: faker.helpers.slugify(faker.lorem.words(3)).toLowerCase(),
    published: faker.datatype.boolean(),
    {% elif model == 'Category' %}
    name: faker.commerce.department(),
    description: faker.lorem.sentence(),
    {% elif model == 'Tag' %}
    name: faker.word.noun(),
    slug: faker.helpers.slugify(faker.word.noun()).toLowerCase(),
    {% else %}
    // TODO: Define factory fields for {{ model }}
    name: faker.lorem.word(),
    {% endif %}
    ...overrides,
  };
}

{% endfor %}
{% endif %}

// =============================================================================
// Seed Functions
// =============================================================================

{% if clear_before_seed %}
async function clearDatabase() {
  console.log("🗑️  Clearing database...");

  // Delete in reverse order of dependencies
  const deleteOperations = [
    {% for model in models_to_seed | reverse %}
    prisma.{{ model | lower }}.deleteMany(),
    {% endfor %}
  ];

  await prisma.$transaction(deleteOperations);
  console.log("✅ Database cleared");
}
{% endif %}

{% for model in models_to_seed %}
async function seed{{ model }}s() {
  console.log("🌱 Seeding {{ model }}s...");

  const count = SEED_CONFIG.{{ model }};
  const data = [];

  for (let i = 0; i < count; i++) {
    {% if use_factories %}
    data.push(create{{ model }}Data());
    {% else %}
    data.push({
      // TODO: Define seed data for {{ model }}
      {% if model == 'User' %}
      email: `user${i + 1}@example.com`,
      name: `User ${i + 1}`,
      {% elif model == 'Post' %}
      title: `Post ${i + 1}`,
      slug: `post-${i + 1}`,
      {% else %}
      name: `{{ model }} ${i + 1}`,
      {% endif %}
    });
    {% endif %}
  }

  const result = await prisma.{{ model | lower }}.createMany({
    data,
    skipDuplicates: true,
  });

  console.log(`✅ Created ${result.count} {{ model }}s`);
  return result;
}

{% endfor %}

// =============================================================================
// Relationship Seeding
// =============================================================================

async function seedRelationships() {
  console.log("🔗 Seeding relationships...");

  // Example: Link Posts to Users
  const users = await prisma.user.findMany({ take: 5 });
  const posts = await prisma.post.findMany();

  if (users.length > 0 && posts.length > 0) {
    await prisma.$transaction(
      posts.map((post, index) => {
        const user = users[index % users.length];
        return prisma.post.update({
          where: { id: post.id },
          data: { authorId: user.id },
        });
      })
    );
    console.log("✅ Linked posts to users");
  }

  // TODO: Add more relationship seeding as needed
}

// =============================================================================
// Development-Specific Seeds
// =============================================================================

async function seedDevelopment() {
  console.log("🔧 Seeding development-specific data...");

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "Admin User",
      role: "ADMIN",
    },
  });
  console.log(`✅ Admin user: ${admin.email}`);

  // Create test user
  const testUser = await prisma.user.upsert({
    where: { email: "test@example.com" },
    update: {},
    create: {
      email: "test@example.com",
      name: "Test User",
      role: "USER",
    },
  });
  console.log(`✅ Test user: ${testUser.email}`);
}

// =============================================================================
// Main Seed Function
// =============================================================================

async function main() {
  console.log("🚀 Starting database seed...\n");

  const startTime = Date.now();

  try {
    {% if clear_before_seed %}
    // Clear existing data
    await clearDatabase();

    {% endif %}
    // Seed models in dependency order
    {% for model in models_to_seed %}
    await seed{{ model }}s();
    {% endfor %}

    // Seed relationships
    await seedRelationships();

    // Development-specific seeds
    if (process.env.NODE_ENV !== "production") {
      await seedDevelopment();
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✨ Seeding completed in ${duration}s`);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    throw error;
  }
}

// =============================================================================
// Execute
// =============================================================================

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
