# Prisma Templates

Code generation templates for Prisma schemas, clients, and integrations.

## Available Templates

| Template | Purpose | Output |
|----------|---------|--------|
| `schema.template.prisma` | Base schema with datasource | `prisma/schema.prisma` |
| `model.template.prisma` | Model with relations | Append to schema |
| `client.template.ts` | Prisma client singleton | `src/lib/prisma.ts` |
| `repository.template.ts` | Repository pattern | `src/repositories/*.ts` |
| `seed.template.ts` | Database seeding | `prisma/seed.ts` |
| `migration.template.ts` | Custom migration runner | `prisma/custom-migration.ts` |
| `supabase_schema.template.prisma` | Supabase-specific schema | `prisma/schema.prisma` |
| `rls_migration.template.sql` | Row Level Security | `prisma/migrations/rls/*.sql` |

## Template Variables

### schema.template.prisma

```javascript
{
  "provider": "postgresql",           // postgresql, mysql, sqlite
  "url_env": "DATABASE_URL",          // Environment variable
  "direct_url_env": "DIRECT_URL",     // For pooled connections
  "preview_features": ["fullTextSearch"],
  "models": [                         // Initial models
    {
      "name": "User",
      "fields": [...]
    }
  ]
}
```

### model.template.prisma

```javascript
{
  "model_name": "Post",
  "fields": [
    { "name": "title", "type": "String" },
    { "name": "content", "type": "String", "optional": true },
    { "name": "published", "type": "Boolean", "default": "false" }
  ],
  "relations": [
    { "name": "author", "model": "User", "field": "authorId" }
  ],
  "indexes": [
    { "fields": ["authorId"] },
    { "fields": ["published", "createdAt"], "sort": "Desc" }
  ],
  "soft_delete": true,
  "timestamps": true
}
```

### client.template.ts

```javascript
{
  "log_levels": ["query", "error", "warn"],  // Logging
  "singleton": true,                          // Global singleton
  "extensions": ["softDelete", "audit"]       // Extensions to add
}
```

### repository.template.ts

```javascript
{
  "entity": "User",                    // Model name
  "entity_lower": "user",              // Prisma accessor
  "include_soft_delete": true,         // Soft delete methods
  "include_pagination": true,          // Paginated queries
  "custom_methods": [                  // Additional methods
    { "name": "findByEmail", "params": "email: string" }
  ]
}
```

### seed.template.ts

```javascript
{
  "models_to_seed": ["User", "Category", "Tag"],
  "use_factories": true,
  "clear_before_seed": true
}
```

### supabase_schema.template.prisma

```javascript
{
  "project_ref": "abcdefghijk",
  "region": "us-east-1",
  "use_pooler": true,
  "include_auth_reference": true
}
```

### rls_migration.template.sql

```javascript
{
  "table": "Post",
  "policies": [
    {
      "name": "Users can read published",
      "operation": "SELECT",
      "using": "published = true"
    },
    {
      "name": "Users can modify own",
      "operation": "ALL",
      "using": "auth.uid()::text = \"authorId\""
    }
  ]
}
```

## Usage

```typescript
// In agent or automation:
const template = loadTemplate("model.template.prisma");
const code = renderTemplate(template, {
  model_name: "Comment",
  fields: [
    { name: "content", type: "String" },
  ],
  relations: [
    { name: "post", model: "Post", field: "postId" },
    { name: "author", model: "User", field: "authorId" },
  ],
  timestamps: true,
});
appendToFile("prisma/schema.prisma", code);
```

## Best Practices

1. **Indexes**: Always add indexes on foreign keys and filtered fields
2. **Soft Delete**: Use deletedAt pattern for recoverable deletes
3. **Timestamps**: Include createdAt/updatedAt on all models
4. **Supabase**: Use pooled connection for app, direct for migrations
5. **RLS**: Apply policies after Prisma migrations
