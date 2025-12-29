# Supabase CLI Skill

**Version**: 1.0.0 | **Category**: Infrastructure | **Auto-Detection**: Yes

---

## Purpose

This skill provides Claude Code agents with comprehensive knowledge of the Supabase CLI for:

- **Database Management**: Migrations, schema diffing, backups
- **Edge Functions**: Create, deploy, and manage serverless functions
- **Local Development**: Run full Supabase stack locally
- **Type Generation**: Generate TypeScript/Go/Swift types from schema
- **Debugging**: Inspect database performance, analyze queries
- **CI/CD Integration**: Automated deployments via GitHub Actions, GitLab CI

---

## Critical: Avoiding Interactive Mode

**Supabase CLI can enter interactive mode which will hang Claude Code.** Always use flags to bypass prompts:

| Command | Interactive | Non-Interactive |
|---------|-------------|-----------------|
| `supabase login` | Opens browser | Use `SUPABASE_ACCESS_TOKEN` env var |
| `supabase link` | Prompts for project | `supabase link --project-ref <ref>` |
| `supabase projects create` | Prompts for options | `supabase projects create <name> --org-id <id> --region <region>` |

**Always include**:
- `SUPABASE_ACCESS_TOKEN` environment variable for authentication
- `--project-ref` flag or pre-linked project
- Explicit flags for all required options

---

## File Organization

| File | Size | Purpose |
|------|------|---------|
| `SKILL.md` | ~21KB | Quick reference for immediate use |
| `REFERENCE.md` | ~28KB | Comprehensive guide with advanced patterns |
| `README.md` | ~4KB | This file - architecture overview |
| `examples/ci-cd.example.yaml` | ~6KB | GitHub Actions deployment examples |

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

## Key Capabilities

### CLI Commands (80+)

```
Project:     init, start, stop, status, link, unlink
Database:    db start/reset/push/pull/dump/diff/lint
Migrations:  migration new/list/up/repair/squash
Functions:   functions new/serve/deploy/delete/list
Secrets:     secrets set/list/unset
Types:       gen types typescript/go/swift
Inspect:     inspect db bloat/blocking/outliers/locks
Storage:     storage ls/cp/mv/rm
Projects:    projects list/create/delete/api-keys
Branches:    branches create/list/get/delete/pause
```

### Static Reference Data

**Regions** (17 AWS regions):
- Americas: `us-west-1`, `us-west-2`, `us-east-1`, `us-east-2`, `ca-central-1`, `sa-east-1`
- Europe: `eu-west-1`, `eu-west-2`, `eu-west-3`, `eu-central-1`, `eu-central-2`, `eu-north-1`
- Asia-Pacific: `ap-south-1`, `ap-southeast-1`, `ap-southeast-2`, `ap-northeast-1`, `ap-northeast-2`

**General Region Codes**: `americas`, `emea`, `apac`

**Local Development Ports**:
- API: 54321
- Database: 54322
- Studio: 54323
- Inbucket: 54324

---

## Authentication Strategy

Priority order for authentication:

1. **Environment Variable**: `SUPABASE_ACCESS_TOKEN`
2. **Native Credentials**: Stored by `supabase login`
3. **Token File**: `~/.supabase/access-token`

```bash
# Recommended pattern for Claude Code
export SUPABASE_ACCESS_TOKEN="$(grep SUPABASE_ACCESS_TOKEN .env | cut -d= -f2)"
export SUPABASE_DB_PASSWORD="$(grep SUPABASE_DB_PASSWORD .env | cut -d= -f2)"
supabase link --project-ref <ref>
```

**Never use `supabase login` in automation** - always use token-based auth.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-27 | Initial release |

---

## Sources

- [Supabase CLI Getting Started](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli/introduction)
- [Supabase Regions](https://supabase.com/docs/guides/platform/regions)
- [Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Edge Functions](https://supabase.com/docs/guides/functions)
