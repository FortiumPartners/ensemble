# Supabase CLI Reference Guide

This comprehensive guide covers all Supabase CLI commands, advanced patterns, and integration strategies.

---

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Authentication Deep Dive](#authentication-deep-dive)
3. [Complete Command Reference](#complete-command-reference)
4. [Local Development](#local-development)
5. [Database Management](#database-management)
6. [Migration Strategies](#migration-strategies)
7. [Edge Functions](#edge-functions)
8. [Type Generation](#type-generation)
9. [Database Inspection & Debugging](#database-inspection--debugging)
10. [Storage Management](#storage-management)
11. [Project & Organization Management](#project--organization-management)
12. [Preview Branches](#preview-branches)
13. [Security & Networking](#security--networking)
14. [CI/CD Integration](#cicd-integration)
15. [Advanced Patterns](#advanced-patterns)
16. [Troubleshooting](#troubleshooting)

---

## Installation & Setup

### System Requirements

- **Node.js**: 20 or later (for npm/npx installation)
- **Docker**: Required for local development (`supabase start`)
- **Git**: Recommended for migration management

### Installation Methods

**npm (Recommended for Node.js projects)**:
```bash
# Global installation
npm install -g supabase

# Project-local installation
npm install --save-dev supabase

# Run via npx
npx supabase --help
```

**Homebrew (macOS/Linux)**:
```bash
brew install supabase/tap/supabase
```

**Scoop (Windows)**:
```bash
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

**Linux Packages**:
```bash
# Debian/Ubuntu (.deb)
wget https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.deb
sudo dpkg -i supabase_linux_amd64.deb

# RPM-based
wget https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.rpm
sudo rpm -i supabase_linux_amd64.rpm
```

**Docker**:
```bash
docker run --rm -it supabase/cli --help
```

### Verify Installation

```bash
supabase --version
# Output: 2.x.x

supabase --help
```

### Shell Completion

```bash
# Bash
supabase completion bash > /etc/bash_completion.d/supabase

# Zsh
supabase completion zsh > "${fpath[1]}/_supabase"

# Fish
supabase completion fish > ~/.config/fish/completions/supabase.fish

# PowerShell
supabase completion powershell > supabase.ps1
```

---

## Authentication Deep Dive

### Token Types

| Token Type | Environment Variable | Scope | Best For |
|------------|---------------------|-------|----------|
| Personal Access Token | `SUPABASE_ACCESS_TOKEN` | All user projects | CI/CD, automation |
| Project Database Password | `SUPABASE_DB_PASSWORD` | Single project | Migration operations |

### Generating Access Tokens

1. Navigate to: `https://supabase.com/dashboard/account/tokens`
2. Click "Generate new token"
3. Name your token (e.g., "CI/CD Pipeline")
4. Copy and store securely

### Authentication Methods

**Method 1: Environment Variable (Recommended for CI/CD)**
```bash
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
supabase projects list  # Works automatically
```

**Method 2: Interactive Login (Local development only)**
```bash
supabase login
# Opens browser for authentication
# Token stored in native credentials or ~/.supabase/access-token
```

**Method 3: Token File (Fallback)**
```bash
# Manual token file creation
echo "sbp_xxxxxxxx" > ~/.supabase/access-token
chmod 600 ~/.supabase/access-token
```

### Project-Specific Authentication

```bash
# Required for db push, db pull, link operations
export SUPABASE_ACCESS_TOKEN="sbp_xxx"
export SUPABASE_DB_PASSWORD="your-database-password"
export SUPABASE_PROJECT_ID="abcdefghijklmnop"

# Link with all credentials
supabase link --project-ref $SUPABASE_PROJECT_ID
```

### Finding Your Credentials

| Credential | Location |
|------------|----------|
| Access Token | Dashboard > Account > Access Tokens |
| Project Ref | Dashboard > Project Settings > General |
| Database Password | Dashboard > Project Settings > Database |
| API Keys | Dashboard > Project Settings > API |

---

## Complete Command Reference

### Global Flags

All commands support these flags:

| Flag | Description |
|------|-------------|
| `--debug` | Enable debug output |
| `--workdir <path>` | Override working directory |
| `--experimental` | Enable experimental features |
| `-h, --help` | Show help for command |

### Project Setup Commands

**supabase init**
```bash
supabase init
# Creates supabase/config.toml and directory structure

# Options
supabase init --workdir /path/to/project
```

**supabase start**
```bash
supabase start
# Starts all local services

# Exclude specific services
supabase start -x gotrue,imgproxy
supabase start -x storage,edge-runtime

# Available services to exclude:
# gotrue, postgrest, imgproxy, storage, edge-runtime, logflare, vector, supavisor
```

**supabase stop**
```bash
supabase stop
# Stops containers, preserves data

supabase stop --no-backup
# Stops containers, removes all data
```

**supabase status**
```bash
supabase status
# Shows running container status and URLs
```

**supabase link**
```bash
# Link to remote project (required for remote operations)
supabase link --project-ref <ref>

# With database password
supabase link --project-ref <ref> --password <password>
```

**supabase unlink**
```bash
supabase unlink
# Removes local project link
```

### Database Commands

**supabase db start**
```bash
supabase db start
# Start only Postgres container
```

**supabase db reset**
```bash
supabase db reset
# Recreates local database, applies all migrations

# Include seed data
supabase db reset --include-seed
```

**supabase db push**
```bash
# Push migrations to remote
supabase db push

# Dry run (show what would happen)
supabase db push --dry-run

# Include seed data
supabase db push --include-seed

# Include all schemas
supabase db push --include-all
```

**supabase db pull**
```bash
# Pull schema from remote
supabase db pull

# Create named migration from remote changes
supabase db pull add_new_tables

# Specific schema only
supabase db pull --schema public,auth
```

**supabase db dump**
```bash
# Schema only dump
supabase db dump -f schema.sql

# Data only dump
supabase db dump --data-only -f data.sql

# Roles only
supabase db dump --role-only -f roles.sql

# From local database
supabase db dump --local -f local.sql

# Specific schema
supabase db dump --schema public -f public.sql
```

**supabase db diff**
```bash
# Diff local vs migrations
supabase db diff

# Diff against remote
supabase db diff --linked

# Create migration from diff
supabase db diff -f my_changes

# Use migra for comparison
supabase db diff --use-migra

# Specific schema
supabase db diff --schema public
```

**supabase db lint**
```bash
# Lint local database
supabase db lint

# Lint remote database
supabase db lint --linked

# Set minimum severity
supabase db lint --level warning
supabase db lint --level error

# Specific schema
supabase db lint --schema public
```

### Migration Commands

**supabase migration new**
```bash
# Create empty migration
supabase migration new create_users_table
# Creates: supabase/migrations/<timestamp>_create_users_table.sql

# Pipe SQL to migration
supabase db diff | supabase migration new schema_changes
```

**supabase migration list**
```bash
# List local and remote migrations
supabase migration list

# Against specific database
supabase migration list --db-url "postgresql://..."
```

**supabase migration up**
```bash
# Apply pending migrations to local
supabase migration up --local

# Apply to remote
supabase migration up --linked

# Apply specific number
supabase migration up --local --count 1
```

**supabase migration repair**
```bash
# Mark migration as applied
supabase migration repair --status applied 20240101000000

# Mark as reverted
supabase migration repair --status reverted 20240101000000

# Dry run
supabase migration repair --dry-run --status applied 20240101000000
```

**supabase migration squash**
```bash
# Squash all migrations
supabase migration squash

# Squash up to version
supabase migration squash --version 20240101000000
```

### Edge Functions Commands

**supabase functions new**
```bash
supabase functions new hello-world
# Creates: supabase/functions/hello-world/index.ts
```

**supabase functions serve**
```bash
# Serve all functions locally
supabase functions serve

# With environment file
supabase functions serve --env-file .env.local

# Enable debugging
supabase functions serve --debug

# Specific function
supabase functions serve hello-world
```

**supabase functions deploy**
```bash
# Deploy specific function
supabase functions deploy hello-world

# Deploy all functions
supabase functions deploy

# Without JWT verification (webhooks)
supabase functions deploy hello-world --no-verify-jwt

# With explicit project
supabase functions deploy --project-ref <ref>

# Import map
supabase functions deploy --import-map supabase/functions/import_map.json
```

**supabase functions delete**
```bash
supabase functions delete hello-world
# Note: Only removes from remote, local files remain
```

**supabase functions list**
```bash
supabase functions list
supabase functions list --project-ref <ref>
```

**supabase functions download**
```bash
supabase functions download hello-world
# Downloads deployed source to local
```

### Secrets Commands

**supabase secrets set**
```bash
# Single secret
supabase secrets set MY_SECRET=value

# Multiple secrets
supabase secrets set KEY1=value1 KEY2=value2

# From .env file
supabase secrets set --env-file .env.production
```

**supabase secrets list**
```bash
supabase secrets list
# Shows names only (values hidden)
```

**supabase secrets unset**
```bash
supabase secrets unset MY_SECRET
supabase secrets unset KEY1 KEY2
```

### Type Generation Commands

**supabase gen types typescript**
```bash
# From remote database
supabase gen types typescript --linked > src/types/database.ts

# From local database
supabase gen types typescript --local > src/types/database.ts

# Specific schema
supabase gen types typescript --linked --schema public,auth

# From database URL
supabase gen types typescript --db-url "postgresql://..."
```

**supabase gen types go**
```bash
supabase gen types go --linked > database/types.go
```

**supabase gen types swift**
```bash
supabase gen types swift --linked > Sources/Database/Types.swift
```

---

## Local Development

### Configuration File

Location: `supabase/config.toml`

```toml
[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 15

[db.pooler]
enabled = false
port = 54329
default_pool_size = 20
max_client_conn = 100

[studio]
enabled = true
port = 54323
api_url = "http://localhost"

[inbucket]
enabled = true
port = 54324
smtp_port = 54325
pop3_port = 54326

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["https://localhost:3000"]
jwt_expiry = 3600
enable_refresh_token_rotation = true

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false

[storage]
enabled = true
file_size_limit = "50MiB"

[edge_runtime]
enabled = true
policy = "per_worker"

[functions.my-function]
verify_jwt = false
```

### Service URLs (Local)

| Service | URL |
|---------|-----|
| API | http://localhost:54321 |
| GraphQL | http://localhost:54321/graphql/v1 |
| Studio | http://localhost:54323 |
| Inbucket | http://localhost:54324 |
| Database | postgresql://postgres:postgres@localhost:54322/postgres |

### Seed Data

Create `supabase/seed.sql`:
```sql
-- Seed data for development
INSERT INTO public.users (email, name) VALUES
  ('test@example.com', 'Test User'),
  ('admin@example.com', 'Admin User');
```

Apply with:
```bash
supabase db reset  # Automatically runs seed.sql
```

---

## Database Management

### Migration Workflow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Create     │────>│  Test        │────>│  Push       │
│  Migration  │     │  Locally     │     │  to Remote  │
└─────────────┘     └──────────────┘     └─────────────┘
```

**Step 1: Create Migration**
```bash
supabase migration new add_profiles_table
```

**Step 2: Write SQL**
```sql
-- supabase/migrations/20240101000000_add_profiles_table.sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);
```

**Step 3: Test Locally**
```bash
supabase db reset
```

**Step 4: Push to Remote**
```bash
supabase db push
```

### Schema Diffing Workflow

```bash
# Make changes in Studio or directly
# Then capture as migration:
supabase db diff -f my_schema_changes

# Review generated migration
cat supabase/migrations/*_my_schema_changes.sql

# Apply to remote
supabase db push
```

### Handling Dashboard-Created Tables

When tables are created via Dashboard, they may have wrong ownership:

```sql
-- Fix ownership (add to migration)
ALTER TABLE public.my_table OWNER TO postgres;

-- Grant permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
```

---

## Migration Strategies

### Strategy 1: Local-First Development

```bash
# 1. Make changes locally
supabase start
# Edit via Studio at localhost:54323

# 2. Generate migration
supabase db diff -f my_changes

# 3. Reset and verify
supabase db reset

# 4. Push to remote
supabase db push
```

### Strategy 2: Remote-First Development

```bash
# 1. Make changes in production Dashboard

# 2. Pull changes
supabase db pull new_feature

# 3. Test locally
supabase db reset

# 4. Commit migration
git add supabase/migrations/
git commit -m "feat: add new feature tables"
```

### Strategy 3: Multi-Environment

```bash
# Staging environment
export SUPABASE_PROJECT_ID=$STAGING_PROJECT_ID
export SUPABASE_DB_PASSWORD=$STAGING_DB_PASSWORD
supabase link --project-ref $SUPABASE_PROJECT_ID
supabase db push

# Production environment
export SUPABASE_PROJECT_ID=$PRODUCTION_PROJECT_ID
export SUPABASE_DB_PASSWORD=$PRODUCTION_DB_PASSWORD
supabase link --project-ref $SUPABASE_PROJECT_ID
supabase db push
```

### Rollback Strategies

Supabase doesn't have built-in rollback. Use these patterns:

**Pattern 1: Compensating Migration**
```bash
supabase migration new rollback_feature_x
```
```sql
-- Undo previous migration manually
DROP TABLE IF EXISTS public.feature_x;
```

**Pattern 2: Point-in-Time Recovery (PITR)**
```bash
# Available on Pro plan
# Restore via Dashboard to specific timestamp
```

---

## Edge Functions

### Function Structure

```
supabase/
└── functions/
    ├── _shared/           # Shared modules
    │   └── cors.ts
    ├── hello-world/
    │   └── index.ts
    └── webhook-handler/
        └── index.ts
```

### Basic Function Template

```typescript
// supabase/functions/hello-world/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { name } = await req.json()
    const data = { message: `Hello ${name}!` }

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})
```

### Function with Supabase Client

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: { Authorization: req.headers.get('Authorization')! },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user?.id)
    .single()

  return new Response(JSON.stringify({ user, profile: data }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

### Webhook Handler (No JWT)

```typescript
// supabase/functions/stripe-webhook/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from 'https://esm.sh/stripe@11.1.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2022-11-15',
  httpClient: Stripe.createFetchHttpClient(),
})

serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')!
  const body = await req.text()

  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    Deno.env.get('STRIPE_WEBHOOK_SECRET')!
  )

  // Handle event...

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

Deploy without JWT verification:
```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

Or in `config.toml`:
```toml
[functions.stripe-webhook]
verify_jwt = false
```

---

## Database Inspection & Debugging

### Performance Analysis Commands

**Find Slow Queries**
```bash
supabase inspect db outliers
# Shows queries with highest total execution time
```

**Check Blocking Queries**
```bash
supabase inspect db blocking
# Shows queries blocking other queries
```

**View Long-Running Queries**
```bash
supabase inspect db long-running-queries
# Queries running > 5 minutes
```

**Check Index Usage**
```bash
supabase inspect db index-usage
# Shows which indexes are being used/unused
```

**Table Bloat Analysis**
```bash
supabase inspect db bloat
# Identifies tables needing VACUUM
```

**Cache Hit Ratios**
```bash
supabase inspect db cache-hit
# Shows buffer cache effectiveness
```

**Table Sizes**
```bash
supabase inspect db table-sizes
# Size of each table
```

**Vacuum Statistics**
```bash
supabase inspect db vacuum-stats
# Dead tuple counts, last vacuum times
```

---

## Storage Management

### Storage Commands

```bash
# List buckets
supabase storage ls

# List files in bucket
supabase storage ls avatars/

# List with details
supabase storage ls avatars/ --long

# Upload file
supabase storage cp ./local-file.jpg avatars/user-1.jpg

# Download file
supabase storage cp avatars/user-1.jpg ./downloaded.jpg

# Move/rename file
supabase storage mv avatars/old-name.jpg avatars/new-name.jpg

# Delete file
supabase storage rm avatars/user-1.jpg

# Delete multiple
supabase storage rm avatars/file1.jpg avatars/file2.jpg
```

### Bucket Seeding

```bash
supabase seed buckets
# Creates buckets defined in config.toml
```

---

## Project & Organization Management

### Organization Commands

```bash
# List organizations
supabase orgs list

# Create organization
supabase orgs create "My Company"
```

### Project Commands

```bash
# List all projects
supabase projects list

# Create new project
supabase projects create "my-project" \
  --org-id <org-id> \
  --region us-east-1 \
  --db-password <password>

# Get API keys
supabase projects api-keys --project-ref <ref>

# Delete project (caution!)
supabase projects delete <ref>
```

---

## Preview Branches

Preview branches allow testing database changes in isolation.

```bash
# Create preview branch
supabase branches create feature-x

# List branches
supabase branches list

# Get branch details
supabase branches get feature-x

# Switch to branch
supabase branches switch feature-x

# Pause branch (save costs)
supabase branches pause feature-x

# Resume branch
supabase branches unpause feature-x

# Delete branch
supabase branches delete feature-x
```

---

## Security & Networking

### SSL Enforcement

```bash
# Check SSL settings
supabase ssl-enforcement get

# Require SSL
supabase ssl-enforcement update --enable-ssl-enforcement
```

### Network Restrictions

```bash
# View current restrictions
supabase network-restrictions get

# Update allowed IPs
supabase network-restrictions update \
  --allowed-ips "1.2.3.4/32" \
  --allowed-ips "5.6.7.8/32"
```

### Network Bans

```bash
# View banned IPs
supabase network-bans get

# Remove ban
supabase network-bans remove --ip "1.2.3.4"
```

### SSO Configuration

```bash
# List identity providers
supabase sso list

# Add SAML provider
supabase sso add \
  --type saml \
  --metadata-url "https://idp.example.com/metadata"

# View provider details
supabase sso show <provider-id>

# Get SAML info for IdP setup
supabase sso info

# Remove provider
supabase sso remove <provider-id>
```

---

## CI/CD Integration

### GitHub Actions - Complete Workflow

```yaml
name: Supabase CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

jobs:
  # Validate migrations on PR
  validate:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Start local Supabase
        run: supabase start

      - name: Verify migrations
        run: supabase db reset

      - name: Run tests
        run: supabase test db

  # Deploy to staging
  staging:
    if: github.ref == 'refs/heads/develop' && github.event_name == 'push'
    runs-on: ubuntu-latest
    env:
      SUPABASE_DB_PASSWORD: ${{ secrets.STAGING_DB_PASSWORD }}
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Link to staging
        run: supabase link --project-ref ${{ secrets.STAGING_PROJECT_ID }}

      - name: Push migrations
        run: supabase db push

      - name: Deploy functions
        run: supabase functions deploy

  # Deploy to production
  production:
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    env:
      SUPABASE_DB_PASSWORD: ${{ secrets.PRODUCTION_DB_PASSWORD }}
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Link to production
        run: supabase link --project-ref ${{ secrets.PRODUCTION_PROJECT_ID }}

      - name: Push migrations
        run: supabase db push

      - name: Deploy functions
        run: supabase functions deploy
```

### GitLab CI

```yaml
stages:
  - validate
  - deploy

variables:
  SUPABASE_ACCESS_TOKEN: $SUPABASE_ACCESS_TOKEN

validate:
  stage: validate
  image: node:20
  services:
    - docker:dind
  script:
    - npm install -g supabase
    - supabase start
    - supabase db reset
    - supabase test db
  only:
    - merge_requests

deploy_staging:
  stage: deploy
  image: node:20
  script:
    - npm install -g supabase
    - supabase link --project-ref $STAGING_PROJECT_ID
    - supabase db push
    - supabase functions deploy
  only:
    - develop
  environment:
    name: staging

deploy_production:
  stage: deploy
  image: node:20
  script:
    - npm install -g supabase
    - supabase link --project-ref $PRODUCTION_PROJECT_ID
    - supabase db push
    - supabase functions deploy
  only:
    - main
  environment:
    name: production
  when: manual
```

---

## Advanced Patterns

### Type-Safe Database Client Generation

```bash
# Generate types on every migration
supabase gen types typescript --linked > src/lib/database.types.ts
```

```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

### Multi-Tenant Patterns

```sql
-- Migration for multi-tenant setup
CREATE SCHEMA IF NOT EXISTS tenant_1;
CREATE SCHEMA IF NOT EXISTS tenant_2;

-- RLS policy for tenant isolation
CREATE POLICY "Tenant isolation"
  ON public.resources
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### Database Testing with pgTAP

```bash
# Create test file
supabase test new my_test
```

```sql
-- supabase/tests/my_test.sql
BEGIN;
SELECT plan(2);

SELECT has_table('public', 'profiles', 'profiles table exists');
SELECT has_column('public', 'profiles', 'full_name', 'profiles has full_name');

SELECT * FROM finish();
ROLLBACK;
```

```bash
# Run tests
supabase test db
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Docker not running | Start Docker Desktop |
| Port conflict | `supabase stop` then `supabase start` |
| Migration out of sync | `supabase migration repair` |
| Permission denied | Check `SUPABASE_ACCESS_TOKEN` |
| Functions not deploying | Check `--project-ref` flag |
| Types not generating | Ensure project is linked |

### Debug Mode

```bash
# Enable verbose output
supabase --debug <command>

# Example
supabase --debug db push
```

### Reset Everything

```bash
# Stop and remove all data
supabase stop --no-backup

# Remove Supabase directory
rm -rf supabase/

# Start fresh
supabase init
supabase start
```

### Check Service Health

```bash
supabase status
# Shows all container statuses and URLs
```

### View Container Logs

```bash
# All services
docker logs supabase_db_*

# Specific service
docker logs supabase_auth_*
docker logs supabase_rest_*
```

---

## Sources

- [Supabase CLI Documentation](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [CLI Reference](https://supabase.com/docs/reference/cli/introduction)
- [Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Edge Functions](https://supabase.com/docs/guides/functions)
- [GitHub Actions Integration](https://supabase.com/docs/guides/deployment/managing-environments)
