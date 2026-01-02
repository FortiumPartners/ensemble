# Vercel CLI Skill

**Version**: 1.0.0 | **Category**: Infrastructure | **Auto-Detection**: Yes

---

## Purpose

This skill provides Claude Code agents with comprehensive knowledge of the Vercel CLI for:

- **Frontend Deployment**: Deploy Next.js, React, Vue, and static sites
- **Serverless Functions**: Deploy and manage API routes
- **Domain Management**: Configure custom domains and SSL
- **Environment Variables**: Manage secrets across environments
- **Debugging**: Access logs, inspect deployments, troubleshoot issues
- **Promotion/Rollback**: Staged deployments and rollback procedures

---

## Critical: Avoiding Interactive Mode

**Vercel CLI can enter interactive mode which will hang Claude Code.** Always use flags to bypass prompts:

| Command | Interactive | Non-Interactive |
|---------|-------------|-----------------|
| `vercel` | Prompts for project | `vercel --yes` |
| `vercel link` | Prompts for project | `vercel link --yes --project <name>` |
| `vercel pull` | Prompts for env | `vercel pull --yes --environment prod` |
| `vercel env rm` | Confirms deletion | `vercel env rm KEY --yes` |
| `vercel domains rm` | Confirms deletion | `vercel domains rm <domain> --yes` |
| `vercel promote` | Confirms preview | `vercel promote <url> --yes` |

**Always include**:
- `--yes` for confirmation prompts
- `--token $VERCEL_TOKEN` for authentication (never `vercel login`)
- Explicit names/IDs instead of interactive selection
- `--no-wait` for redeploy commands

---

## File Organization

| File | Size | Purpose |
|------|------|---------|
| `SKILL.md` | ~22KB | Quick reference for immediate use |
| `REFERENCE.md` | ~28KB | Comprehensive guide with advanced patterns |
| `README.md` | ~4KB | This file - architecture overview |
| `examples/ci-cd.example.yaml` | ~5KB | GitHub Actions deployment examples |

---

## Auto-Detection Triggers

This skill auto-loads when Vercel context is detected:

**File-based triggers**:
- `vercel.json` in project root
- `.vercel` directory present
- `VERCEL_TOKEN` in `.env` file

**Context-based triggers**:
- User mentions "Vercel", "deploy to Vercel"
- User runs vercel CLI commands
- Debugging Vercel deployments
- Next.js/React deployment discussions

---

## Agent Integration

### Compatible Agents

| Agent | Use Case |
|-------|----------|
| `deployment-orchestrator` | Automated deployments, CI/CD |
| `infrastructure-developer` | Infrastructure provisioning |
| `deep-debugger` | Production debugging, log analysis |
| `frontend-developer` | React/Next.js deployments |

### Handoff Patterns

**To Deep-Debugger**:
```yaml
When:
  - Build failures with unclear errors
  - Runtime errors in serverless functions
  - Performance issues requiring profiling

Provide:
  - vercel logs output
  - vercel inspect output
  - Relevant error messages
```

**From Deep-Debugger**:
```yaml
When:
  - Issue identified as Vercel configuration
  - Need to redeploy after fix
  - Environment variable changes needed
```

---

## Key Capabilities

### CLI Commands (35+)

```
Project:     link, project (ls/add/rm), whoami, switch, teams
Deployment:  deploy, redeploy, promote, rollback, list, inspect, remove
Environment: env (ls/add/rm/pull), pull
Domains:     domains (ls/add/rm/inspect/move)
Aliases:     alias (ls/set/rm)
DNS:         dns (ls/add/rm)
Certs:       certs (ls/issue/rm)
Debugging:   logs, inspect, httpstat
Dev:         dev, build (interactive - avoid in automation)
```

### Static Reference Data

**Regions** (19 compute regions):
- Americas: `iad1`, `cle1`, `sfo1`, `pdx1`, `gru1`
- Europe: `lhr1`, `fra1`, `cdg1`, `dub1`, `arn1`
- Asia-Pacific: `hnd1`, `kix1`, `sin1`, `syd1`, `hkg1`, `icn1`, `bom1`
- Middle East/Africa: `dxb1`, `cpt1`

**Default Region**: `iad1` (Washington DC)

**Edge Network**: 126 PoPs in 94 cities across 51 countries

---

## Authentication Strategy

Priority order for authentication:

1. **Project `.env`**: Check for `VERCEL_TOKEN`
2. **Environment Variable**: `VERCEL_TOKEN`
3. **Command-line flag**: `--token <TOKEN>`

```bash
# Recommended pattern for Claude Code
export VERCEL_TOKEN="$(grep VERCEL_TOKEN .env | cut -d= -f2)"
vercel --token $VERCEL_TOKEN <command> --yes
```

**Never use `vercel login` in automation** - always use token-based auth.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-27 | Initial release |

---

## Sources

- [Vercel CLI Overview](https://vercel.com/docs/cli)
- [Vercel CLI Deploy](https://vercel.com/docs/cli/deploy)
- [Vercel Regions](https://vercel.com/docs/regions)
- [Vercel Environment Variables](https://vercel.com/docs/cli/env)
- [Vercel Domains](https://vercel.com/docs/cli/domains)
