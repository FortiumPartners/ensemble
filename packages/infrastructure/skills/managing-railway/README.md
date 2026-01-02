# Railway CLI Skill

**Version**: 1.0.0 | **Category**: Infrastructure | **Auto-Detection**: Yes

---

## Purpose

This skill provides Claude Code agents with comprehensive knowledge of the Railway CLI for:

- **Service Deployment**: Deploy applications via `railway up`
- **Database Management**: Add and connect to PostgreSQL, MySQL, Redis, MongoDB
- **Debugging**: Access logs, SSH into services, troubleshoot deployments
- **Networking**: Configure domains, private networking, and variables
- **Environment Management**: Multi-environment setups and CI/CD integration

---

## Critical: Avoiding Interactive Mode

**Railway CLI can enter interactive mode which will hang Claude Code.** Always use flags to bypass prompts:

| Command | Interactive | Non-Interactive |
|---------|-------------|-----------------|
| `railway link` | Prompts for project | `railway link -p <project>` |
| `railway init` | Prompts for name | `railway init -n <name>` |
| `railway environment` | Prompts for selection | `railway environment <name>` |
| `railway service` | Prompts for selection | `railway service <name>` |
| `railway down` | Confirms deletion | `railway down -y` |
| `railway redeploy` | Confirms redeploy | `railway redeploy -y` |
| `railway environment delete` | Confirms deletion | `railway environment delete -y` |
| `railway up` | Waits for completion | `railway up --detach` |

**Always include**:
- `-y` or `--yes` for confirmation prompts
- `--detach` or `-d` for deployment commands
- Explicit names/IDs instead of interactive selection
- `--json` for programmatic output parsing

---

## File Organization

| File | Size | Purpose |
|------|------|---------|
| `SKILL.md` | ~20KB | Quick reference for immediate use |
| `REFERENCE.md` | ~45KB | Comprehensive guide with advanced patterns |
| `README.md` | ~3KB | This file - architecture overview |
| `examples/ci-cd.example.yaml` | ~2KB | GitHub Actions deployment example |

---

## Auto-Detection Triggers

This skill auto-loads when Railway context is detected:

**File-based triggers**:
- `railway.json` or `railway.toml` in project root
- `RAILWAY_TOKEN` in `.env` file
- `RAILWAY_API_TOKEN` environment variable

**Context-based triggers**:
- User mentions "Railway", "deploy to Railway"
- User runs railway CLI commands
- Debugging Railway-hosted services
- Database connection issues with Railway references

---

## Agent Integration

### Compatible Agents

| Agent | Use Case |
|-------|----------|
| `deployment-orchestrator` | Automated deployments, CI/CD |
| `infrastructure-developer` | Infrastructure provisioning |
| `deep-debugger` | Production debugging, log analysis |
| `backend-developer` | Database connections, environment setup |

### Handoff Patterns

**To Deep-Debugger**:
```yaml
When:
  - Build failures with unclear errors
  - Runtime crashes requiring code analysis
  - Performance issues requiring profiling

Provide:
  - railway logs output
  - railway status output
  - Relevant error messages
```

**From Deep-Debugger**:
```yaml
When:
  - Issue identified as Railway configuration
  - Need to redeploy after fix
  - Environment variable changes needed
```

---

## Key Capabilities

### CLI Commands (22 total)

```
Project:     init, link, list, unlink, status, open, whoami
Deployment:  up, redeploy, down, deploy, logs
Services:    add, service, connect, run, shell
Environment: environment, variables
Debugging:   ssh, logs, status
Storage:     volume (list, add, delete, attach, detach)
Networking:  domain
```

### Static Reference Data

**Regions** (Railway Metal):
- `us-west2` - California
- `us-east4-eqdc4a` - Virginia
- `europe-west4-drams3a` - Amsterdam
- `asia-southeast1-eqsg3a` - Singapore

**Database Types**: postgres, mysql, redis, mongo

**Railway Variables**: RAILWAY_PUBLIC_DOMAIN, RAILWAY_PRIVATE_DOMAIN, RAILWAY_TCP_PROXY_PORT

---

## Authentication Strategy

Priority order for authentication:

1. **Project `.env`**: Check for `RAILWAY_TOKEN`
2. **Environment Variable**: `RAILWAY_TOKEN` or `RAILWAY_API_TOKEN`
3. **Interactive Login**: `railway login` (NOT for automated use)

```bash
# Recommended pattern for Claude Code
export RAILWAY_TOKEN="$(grep RAILWAY_TOKEN .env | cut -d= -f2)"
railway <command>
```

**Never use `railway login` in automation** - always use token-based auth.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-27 | Initial release |

---

## Sources

- [Railway CLI Reference](https://docs.railway.com/reference/cli-api)
- [Railway CLI Guide](https://docs.railway.com/guides/cli)
- [Railway Private Networking](https://docs.railway.com/guides/private-networking)
- [Railway Variables](https://docs.railway.com/guides/variables)
- [Railway CLI GitHub](https://github.com/railwayapp/cli)
