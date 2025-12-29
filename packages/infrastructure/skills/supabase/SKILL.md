---
name: supabase
description: Supabase CLI for database management, Edge Functions, migrations, and local development. Use for managing Postgres databases, deploying serverless functions, and debugging Supabase projects.
version: 1.0.0
allowed-tools: Bash, Read, Glob, Grep
---

# Supabase CLI Skill

## Quick Reference

Supabase CLI enables local development, database migrations, Edge Functions deployment, and project management for Supabase projects.

---

## Critical: Avoiding Interactive Mode

**Supabase CLI can enter interactive mode which will hang Claude Code.** Always use flags to bypass prompts:

| Command | WRONG (Interactive) | CORRECT (Non-Interactive) |
|---------|---------------------|---------------------------|
| Login | `supabase login` | Use `SUPABASE_ACCESS_TOKEN` env var |
| Link project | `supabase link` | `supabase link --project-ref <ref>` |
| Create project | `supabase projects create` | `supabase projects create <name> --org-id <id> --region <region>` |
| Start local | `supabase start` | `supabase start` (non-interactive by default) |
| Deploy functions | `supabase functions deploy` | `supabase functions deploy <name> --project-ref <ref>` |

**Never use in Claude Code**:
- `supabase login` without token (opens browser)
- Any command without `--project-ref` when not linked
- Interactive prompts for organization/region selection

**Always include**:
- `SUPABASE_ACCESS_TOKEN` environment variable for authentication
- `--project-ref` flag or pre-linked project
- Explicit flags for all configuration options

---

## Prerequisites

### Installation Verification

```bash
supabase --version
# Expected: 2.x.x or higher
```

### Installation Methods

```bash
# npm (requires Node.js 20+)
npm install -g supabase

# Homebrew (macOS/Linux)
brew install supabase/tap/supabase

# Scoop (Windows)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Direct download
# Linux: .apk, .deb, .rpm packages available
```

### Update Commands

```bash
# npm
npm update -g supabase

# Homebrew
brew upgrade supabase

# Scoop
scoop update supabase
```

---

## Authentication Strategy

### Environment Variables (CI/CD Required)

| Variable | Purpose | Required For |
|----------|---------|--------------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token | All remote operations |
| `SUPABASE_DB_PASSWORD` | Database password | `db push`, `db pull`, `link` |
| `SUPABASE_PROJECT_ID` | Project reference string | Linking without interactive prompt |

### Token Generation

Generate tokens at: `https://supabase.com/dashboard/account/tokens`

### Authentication Pattern for Claude Code

```bash
# Set from project .env file
export SUPABASE_ACCESS_TOKEN="$(grep SUPABASE_ACCESS_TOKEN .env | cut -d= -f2)"
export SUPABASE_DB_PASSWORD="$(grep SUPABASE_DB_PASSWORD .env | cut -d= -f2)"

# All commands will use these automatically
supabase projects list
supabase link --project-ref <ref>
```

### Token Storage Location

When using `supabase login`, token is stored in:
- Native credentials storage (preferred)
- Fallback: `~/.supabase/access-token` (plain text)

**For CI/CD**: Always use `SUPABASE_ACCESS_TOKEN` environment variable instead.

---

## CLI Decision Tree

### What do you need to do?

```
Project Setup
├── Initialize local project ──────────► supabase init
├── Link to remote project ────────────► supabase link --project-ref <ref>
├── Start local stack ─────────────────► supabase start
├── Stop local stack ──────────────────► supabase stop
└── Check status ──────────────────────► supabase status

Database Operations
├── Create migration ──────────────────► supabase migration new <name>
├── Apply migrations locally ──────────► supabase db reset
├── Push migrations to remote ─────────► supabase db push
├── Pull remote schema ────────────────► supabase db pull
├── Diff local vs remote ──────────────► supabase db diff --linked
├── Dump remote database ──────────────► supabase db dump
├── Lint database schema ──────────────► supabase db lint
└── Run database tests ────────────────► supabase test db

Edge Functions
├── Create new function ───────────────► supabase functions new <name>
├── Serve locally ─────────────────────► supabase functions serve
├── Deploy single function ────────────► supabase functions deploy <name>
├── Deploy all functions ──────────────► supabase functions deploy
├── List deployed functions ───────────► supabase functions list
├── Download function code ────────────► supabase functions download <name>
└── Delete function ───────────────────► supabase functions delete <name>

Secrets Management
├── Set secret ────────────────────────► supabase secrets set NAME=value
├── Set from file ─────────────────────► supabase secrets set --env-file .env
├── List secrets ──────────────────────► supabase secrets list
└── Remove secret ─────────────────────► supabase secrets unset NAME

Type Generation
├── Generate TypeScript types ─────────► supabase gen types typescript --linked
├── Generate from local ───────────────► supabase gen types typescript --local
└── Generate Go types ─────────────────► supabase gen types go --linked

Project Management
├── List projects ─────────────────────► supabase projects list
├── Create project ────────────────────► supabase projects create <name> --org-id <id> --region <region>
├── Get API keys ──────────────────────► supabase projects api-keys --project-ref <ref>
└── Delete project ────────────────────► supabase projects delete <ref>

Debugging
├── View container logs ───────────────► supabase logs (local)
├── Inspect database stats ────────────► supabase inspect db <subcommand>
├── Check slow queries ────────────────► supabase inspect db outliers
└── View blocking queries ─────────────► supabase inspect db blocking

Storage Operations
├── List files ────────────────────────► supabase storage ls [path]
├── Copy files ────────────────────────► supabase storage cp <src> <dst>
├── Move files ────────────────────────► supabase storage mv <src> <dst>
└── Delete files ──────────────────────► supabase storage rm <path>
```

---

## Command Reference

### Project Setup Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `supabase init` | Initialize local project | `--workdir` |
| `supabase start` | Start local development stack | `-x` (exclude services) |
| `supabase stop` | Stop local stack | `--no-backup` (skip data backup) |
| `supabase status` | Show local container status | - |
| `supabase link` | Link to remote project | `--project-ref <ref>` (required) |
| `supabase unlink` | Unlink from remote project | - |

### Database Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `supabase db start` | Start Postgres container | - |
| `supabase db reset` | Reset local database | - |
| `supabase db push` | Push migrations to remote | `--dry-run`, `--include-seed` |
| `supabase db pull` | Pull schema from remote | `--schema <name>` |
| `supabase db dump` | Dump remote database | `--data-only`, `--role-only`, `-f <file>` |
| `supabase db diff` | Diff schema changes | `--linked`, `--local`, `-f <name>` |
| `supabase db lint` | Lint for schema errors | `--linked`, `--level <warning\|error>` |

### Migration Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `supabase migration new` | Create new migration | `<name>` (required) |
| `supabase migration list` | List migration history | `--db-url <url>` |
| `supabase migration up` | Apply pending migrations | `--local`, `--linked` |
| `supabase migration repair` | Fix migration history | `--status <applied\|reverted>` |
| `supabase migration squash` | Squash migrations | `--version <timestamp>` |
| `supabase migration fetch` | Fetch history records | - |

### Edge Functions Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `supabase functions new` | Create new function | `<name>` (required) |
| `supabase functions serve` | Serve locally | `--env-file <path>` |
| `supabase functions deploy` | Deploy function(s) | `--no-verify-jwt`, `--project-ref` |
| `supabase functions delete` | Delete function | `<name>` (required) |
| `supabase functions list` | List functions | `--project-ref` |
| `supabase functions download` | Download source | `<name>` (required) |

### Secrets Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `supabase secrets set` | Set secret(s) | `NAME=value`, `--env-file <path>` |
| `supabase secrets list` | List secrets | `--project-ref` |
| `supabase secrets unset` | Remove secret(s) | `<NAME>` |

### Type Generation Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `supabase gen types typescript` | Generate TS types | `--linked`, `--local`, `--schema` |
| `supabase gen types go` | Generate Go types | `--linked`, `--local` |
| `supabase gen types swift` | Generate Swift types | `--linked`, `--local` |

### Database Inspection Commands

| Command | Description |
|---------|-------------|
| `supabase inspect db bloat` | Identify bloated tables |
| `supabase inspect db blocking` | Show lock contention |
| `supabase inspect db calls` | Queries by frequency |
| `supabase inspect db cache-hit` | Cache hit ratios |
| `supabase inspect db index-usage` | Index utilization |
| `supabase inspect db locks` | Current lock holders |
| `supabase inspect db long-running-queries` | Queries > 5 minutes |
| `supabase inspect db outliers` | Slowest queries |
| `supabase inspect db replication-slots` | Replication status |
| `supabase inspect db table-sizes` | Table sizes |
| `supabase inspect db vacuum-stats` | Vacuum status |

---

## Static Reference Data

### Regions (AWS)

| Code | Location | General Region |
|------|----------|----------------|
| `us-west-1` | North California, USA | Americas |
| `us-west-2` | Oregon, USA | Americas |
| `us-east-1` | North Virginia, USA | Americas |
| `us-east-2` | Ohio, USA | Americas |
| `ca-central-1` | Central Canada | Americas |
| `sa-east-1` | Sao Paulo, Brazil | Americas |
| `eu-west-1` | Ireland | EMEA |
| `eu-west-2` | London, UK | EMEA |
| `eu-west-3` | Paris, France | EMEA |
| `eu-central-1` | Frankfurt, Germany | EMEA |
| `eu-central-2` | Zurich, Switzerland | EMEA |
| `eu-north-1` | Stockholm, Sweden | EMEA |
| `ap-south-1` | Mumbai, India | APAC |
| `ap-southeast-1` | Singapore | APAC |
| `ap-southeast-2` | Sydney, Australia | APAC |
| `ap-northeast-1` | Tokyo, Japan | APAC |
| `ap-northeast-2` | Seoul, South Korea | APAC |

**General Region Codes** (for smart region selection):
- `americas` - Auto-selects best Americas region
- `emea` - Auto-selects best Europe/Middle East/Africa region
- `apac` - Auto-selects best Asia-Pacific region

### Supabase-Provided Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Project API URL |
| `SUPABASE_ANON_KEY` | Anonymous/public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (admin) |
| `SUPABASE_DB_URL` | Direct database connection string |

### Local Development Ports

| Service | Port | URL |
|---------|------|-----|
| API Gateway | 54321 | `http://localhost:54321` |
| Database | 54322 | `postgresql://postgres:postgres@localhost:54322/postgres` |
| Studio | 54323 | `http://localhost:54323` |
| Inbucket (Email) | 54324 | `http://localhost:54324` |
| Edge Functions | 54321 | `http://localhost:54321/functions/v1/<name>` |

---

## Common Workflows

### 1. Initialize New Project

```bash
# Create local project structure
supabase init

# Link to existing remote project
export SUPABASE_ACCESS_TOKEN="your-token"
supabase link --project-ref <project-ref>

# Start local development
supabase start
```

### 2. Create and Apply Migrations

```bash
# Create new migration
supabase migration new add_users_table

# Edit migration file at supabase/migrations/<timestamp>_add_users_table.sql

# Apply locally
supabase db reset

# Push to remote
supabase db push
```

### 3. Pull Remote Schema Changes

```bash
# Link project first
supabase link --project-ref <ref>

# Pull all schema changes
supabase db pull

# Or create migration from remote changes
supabase db pull --schema public
```

### 4. Deploy Edge Functions

```bash
# Create new function
supabase functions new hello-world

# Edit supabase/functions/hello-world/index.ts

# Test locally
supabase functions serve

# Deploy to production
supabase functions deploy hello-world

# Deploy without JWT verification (for webhooks)
supabase functions deploy hello-world --no-verify-jwt
```

### 5. Manage Secrets

```bash
# Set individual secret
supabase secrets set STRIPE_KEY=sk_test_xxx

# Set from .env file
supabase secrets set --env-file .env.production

# List current secrets
supabase secrets list

# Remove secret
supabase secrets unset STRIPE_KEY
```

### 6. Generate TypeScript Types

```bash
# From remote database
supabase gen types typescript --linked > src/types/database.ts

# From local database
supabase gen types typescript --local > src/types/database.ts
```

### 7. Debug Database Performance

```bash
# Find slow queries
supabase inspect db outliers

# Check for blocking queries
supabase inspect db blocking

# View table bloat
supabase inspect db bloat

# Check cache hit ratios
supabase inspect db cache-hit
```

---

## Error Handling

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `Error: You need to be logged in` | Missing access token | Set `SUPABASE_ACCESS_TOKEN` env var |
| `Error: Project ref is required` | No project linked | Use `--project-ref` or run `supabase link` |
| `Error: Cannot connect to Docker` | Docker not running | Start Docker Desktop |
| `Error: Port 54321 already in use` | Previous instance running | Run `supabase stop` first |
| `Error: Migration failed` | SQL syntax error | Check migration file syntax |
| `Error: Permission denied` | Table ownership issue | Run `ALTER TABLE ... OWNER TO postgres` |

### Docker Issues

```bash
# Check if Docker is running
docker info

# Clean up Supabase containers
supabase stop --no-backup
docker system prune -f

# Restart with fresh state
supabase start
```

### Migration Conflicts

```bash
# View migration status
supabase migration list

# Repair migration history
supabase migration repair --status reverted <version>

# Squash migrations if needed
supabase migration squash --version <timestamp>
```

---

## CI/CD Integration

### Required Environment Variables

```yaml
env:
  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
  SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
  SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
```

### GitHub Actions Setup

```yaml
- uses: supabase/setup-cli@v1
  with:
    version: latest

- run: supabase link --project-ref $SUPABASE_PROJECT_ID
- run: supabase db push
```

### Non-Interactive Deployment Pattern

```bash
# Set all required env vars
export SUPABASE_ACCESS_TOKEN="$TOKEN"
export SUPABASE_DB_PASSWORD="$DB_PASSWORD"

# Link without prompts
supabase link --project-ref "$PROJECT_ID"

# Push migrations
supabase db push

# Deploy functions
supabase functions deploy --project-ref "$PROJECT_ID"
```

---

## Auto-Detection Triggers

This skill auto-loads when Supabase context is detected:

**File-based triggers**:
- `supabase/config.toml` in project
- `supabase/` directory present
- `SUPABASE_ACCESS_TOKEN` in `.env` file

**Context-based triggers**:
- User mentions "Supabase"
- User runs supabase CLI commands
- Database migration discussions
- Edge Functions deployment
- Debugging Supabase-hosted services

---

## Agent Integration

### Compatible Agents

| Agent | Use Case |
|-------|----------|
| `deployment-orchestrator` | Automated deployments, CI/CD |
| `infrastructure-developer` | Database provisioning |
| `deep-debugger` | Query analysis, performance debugging |
| `backend-developer` | Database schema, Edge Functions |
| `postgresql-specialist` | Advanced database operations |

### Handoff Patterns

**To Deep-Debugger**:
```yaml
When:
  - Slow query investigation needed
  - Migration failures with unclear errors
  - Edge Function runtime errors
  - Database performance issues

Provide:
  - supabase inspect db outliers output
  - Error messages from db push
  - Function logs from supabase functions serve
```

**From Deep-Debugger**:
```yaml
When:
  - Issue identified as schema problem
  - Need to apply fix via migration
  - Environment variable changes needed
```

---

## Sources

- [Supabase CLI Getting Started](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli/introduction)
- [Supabase Regions](https://supabase.com/docs/guides/platform/regions)
- [Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Edge Functions Deploy](https://supabase.com/docs/guides/functions/deploy)
