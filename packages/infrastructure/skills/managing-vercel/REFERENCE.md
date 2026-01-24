# Vercel CLI Reference Guide

**Version**: 1.0.0 | **Target**: <50KB | **Purpose**: Comprehensive reference for Vercel CLI operations

---

## Critical: Non-Interactive Mode

**All commands in this reference use non-interactive flags.** Vercel CLI can enter interactive mode which will hang Claude Code agents.

**Required patterns**:
- Always use `--yes` for confirmation prompts
- Always use `--token` or `VERCEL_TOKEN` environment variable
- Always specify explicit project/environment names
- Use `--no-wait` for commands that wait for completion
- Avoid `vercel login` and `vercel dev` (both interactive)

---

## Table of Contents

1. [Complete Command Documentation](#complete-command-documentation)
2. [Advanced Deployment Patterns](#advanced-deployment-patterns)
3. [Environment Variable Strategies](#environment-variable-strategies)
4. [Domain & SSL Management](#domain--ssl-management)
5. [Multi-Region Configuration](#multi-region-configuration)
6. [CI/CD Integration](#cicd-integration)
7. [Monitoring and Observability](#monitoring-and-observability)
8. [Security Best Practices](#security-best-practices)
9. [Troubleshooting Deep Dive](#troubleshooting-deep-dive)
10. [vercel.json Configuration](#verceljson-configuration)
11. [Cost Optimization](#cost-optimization)

---

## Complete Command Documentation

### vercel (deploy)

Deploy your project.

```bash
vercel [path] [OPTIONS]

OPTIONS:
  --yes, -y              Skip confirmation prompts
  --prod                 Deploy to production
  --skip-domain          Skip domain assignment (staged deployment)
  --prebuilt             Deploy prebuilt output from .vercel/output
  --archive <format>     Archive format (tgz)
  --env <key=value>      Set environment variable for build
  --build-env <key=val>  Set build-time environment variable
  --meta <key=value>     Set deployment metadata
  --regions <regions>    Set function regions
  --token <token>        Authentication token
  --scope <team>         Team scope

EXAMPLES:
  vercel --yes                           # Deploy preview
  vercel --prod --yes                    # Deploy production
  vercel --prod --skip-domain --yes      # Staged production
  vercel ./frontend --yes                # Deploy specific path
  vercel --prebuilt --yes                # Deploy prebuilt
```

### vercel link

Link local directory to Vercel project.

```bash
vercel link [path] [OPTIONS]

OPTIONS:
  --yes                  Skip prompts, use defaults
  --project <name>       Project name (non-interactive)
  --repo                 Link all repo projects (alpha)
  --token <token>        Authentication token
  --scope <team>         Team scope

EXAMPLES:
  vercel link --yes --project myapp
  vercel link ./frontend --yes --project frontend
  vercel link --repo                     # Link entire monorepo
```

### vercel project

Manage Vercel projects.

```bash
vercel project <subcommand> [OPTIONS]

SUBCOMMANDS:
  ls                     List all projects
  add <name>             Create new project
  rm <name>              Remove project

OPTIONS:
  --json                 Output as JSON
  --update-required      Show projects needing updates
  --yes                  Skip confirmation (for rm)

EXAMPLES:
  vercel project ls --json
  vercel project ls --update-required
  vercel project add myapp
  vercel project rm myapp --yes
```

### vercel env

Manage environment variables.

```bash
vercel env <subcommand> [OPTIONS]

SUBCOMMANDS:
  ls [env] [branch]      List variables
  add <name> [env]       Add variable
  rm <name>              Remove variable
  pull [file]            Export to local file

OPTIONS:
  --yes                  Skip confirmation/overwrite prompts
  --environment <env>    Target environment (production/preview/development)
  --git-branch <branch>  Target specific git branch

EXAMPLES:
  vercel env ls production
  vercel env ls preview feature-branch
  echo "value" | vercel env add API_KEY production
  vercel env add SECRET production < secret.txt
  vercel env rm OLD_KEY --yes
  vercel env pull .env.local --yes
```

### vercel pull

Pull environment variables and project settings.

```bash
vercel pull [OPTIONS]

OPTIONS:
  --yes                  Skip prompts
  --environment <env>    Environment (production/preview/development)
  --git-branch <branch>  Specific git branch

EXAMPLES:
  vercel pull --yes
  vercel pull --yes --environment production
  vercel pull --yes --environment preview --git-branch feature-1
```

### vercel domains

Manage domains.

```bash
vercel domains <subcommand> [OPTIONS]

SUBCOMMANDS:
  ls                     List domains
  add <domain> [project] Add domain
  rm <domain>            Remove domain
  inspect <domain>       Inspect domain details
  move <domain> <scope>  Move to another team
  buy <domain>           Purchase domain
  transfer-in <domain>   Transfer domain in

OPTIONS:
  --yes                  Skip confirmation (for rm)
  --force                Force add (remove from existing project)
  --limit <n>            Max results (default: 20, max: 100)

EXAMPLES:
  vercel domains ls --limit 100
  vercel domains add api.example.com myapp
  vercel domains add api.example.com myapp --force
  vercel domains rm api.example.com --yes
  vercel domains inspect example.com
```

### vercel alias

Manage deployment aliases.

```bash
vercel alias <subcommand> [OPTIONS]

SUBCOMMANDS:
  ls                     List aliases
  set <url> <domain>     Set alias
  rm <domain>            Remove alias

OPTIONS:
  --yes                  Skip confirmation (for rm)
  --limit <n>            Max results (default: 20, max: 100)

EXAMPLES:
  vercel alias ls --limit 100
  vercel alias set https://myapp-abc123.vercel.app api.example.com
  vercel alias rm api.example.com --yes
```

### vercel logs

View deployment logs.

```bash
vercel logs <deployment-url|id> [OPTIONS]

OPTIONS:
  --json, -j             Output as JSON
  --token <token>        Authentication token

EXAMPLES:
  vercel logs https://myapp-abc123.vercel.app
  vercel logs myapp-abc123 --json
  vercel logs <url> --json | jq 'select(.level == "error")'
```

### vercel inspect

Inspect deployment details.

```bash
vercel inspect <deployment-url|id> [OPTIONS]

EXAMPLES:
  vercel inspect https://myapp-abc123.vercel.app
  vercel inspect myapp-abc123
```

### vercel list

List deployments.

```bash
vercel list [project] [OPTIONS]

OPTIONS:
  --json                 Output as JSON
  --meta <key=value>     Filter by metadata

EXAMPLES:
  vercel list --json
  vercel list myapp --json
  vercel list --json | jq '.[0:5]'
```

### vercel remove

Remove deployment.

```bash
vercel remove <deployment-url|id> [OPTIONS]

OPTIONS:
  --yes, -y              Skip confirmation
  --safe                 Don't remove production deployment

EXAMPLES:
  vercel remove https://myapp-abc123.vercel.app --yes
  vercel remove myapp-abc123 --yes --safe
```

### vercel redeploy

Redeploy existing deployment.

```bash
vercel redeploy <deployment-url|id> [OPTIONS]

OPTIONS:
  --no-wait              Don't wait for completion
  --target <env>         Target environment (production/preview/custom)
  --token <token>        Authentication token

EXAMPLES:
  vercel redeploy https://myapp-abc123.vercel.app --no-wait
  vercel redeploy myapp-abc123 --target=staging --no-wait
```

### vercel promote

Promote deployment to production.

```bash
vercel promote <deployment-url|id> [OPTIONS]

OPTIONS:
  --yes                  Skip confirmation for preview promotions
  --timeout <duration>   Wait timeout (default: 3m, 0 = no wait)

EXAMPLES:
  vercel promote https://myapp-abc123.vercel.app --yes
  vercel promote myapp-abc123 --timeout=5m
```

### vercel rollback

Rollback to previous deployment.

```bash
vercel rollback [deployment-url|id] [OPTIONS]

OPTIONS:
  --timeout <duration>   Wait timeout (0 = no wait)

EXAMPLES:
  vercel rollback                        # Check rollback status
  vercel rollback https://myapp-old.vercel.app
  vercel rollback --timeout=0            # Async rollback
```

### vercel dns

Manage DNS records.

```bash
vercel dns <subcommand> [OPTIONS]

SUBCOMMANDS:
  ls <domain>            List DNS records
  add <domain> <record>  Add DNS record
  rm <record-id>         Remove DNS record
  import <domain> <file> Import zone file

EXAMPLES:
  vercel dns ls example.com
  vercel dns add example.com A 1.2.3.4
  vercel dns add example.com CNAME www target.com
  vercel dns rm rec_abc123
```

### vercel certs

Manage SSL certificates.

```bash
vercel certs <subcommand> [OPTIONS]

SUBCOMMANDS:
  ls                     List certificates
  issue <domain>         Issue new certificate
  rm <domain>            Remove certificate

EXAMPLES:
  vercel certs ls
  vercel certs issue example.com
  vercel certs rm example.com
```

### vercel teams

Manage teams.

```bash
vercel teams <subcommand>

SUBCOMMANDS:
  ls                     List teams
  add                    Create team (interactive)
  switch <slug>          Switch active team
  invite <email>         Invite user to team

EXAMPLES:
  vercel teams ls
  vercel switch my-team
  vercel teams invite user@example.com
```

### vercel build

Build project locally.

```bash
vercel build [OPTIONS]

OPTIONS:
  --yes                  Skip prompts
  --prod                 Build for production
  --output <dir>         Output directory

EXAMPLES:
  vercel build --yes
  vercel build --prod --yes
```

---

## Advanced Deployment Patterns

### Zero-Downtime Deployments

Vercel provides automatic zero-downtime deployments:

1. New deployment builds alongside existing
2. Health checks validate new deployment
3. Traffic atomically switches to new deployment
4. Old deployment remains accessible for rollback

### Staged Production Deployments

Deploy to production without affecting live traffic:

```bash
# 1. Deploy to production without domain assignment
vercel --prod --skip-domain --yes > staged-url.txt

# 2. Verify staged deployment
STAGED_URL=$(cat staged-url.txt)
curl -I $STAGED_URL

# 3. Promote to production
vercel promote $STAGED_URL --yes
```

### Blue-Green Deployments

Use aliases for blue-green:

```bash
# Deploy new version
vercel --prod --yes > new-deployment.txt

# Test new deployment directly
NEW_URL=$(cat new-deployment.txt)
curl $NEW_URL/health

# Switch alias (instant cutover)
vercel alias set $NEW_URL production.example.com
```

### Canary Releases

Use preview deployments for canary testing:

```bash
# Deploy as preview (not production)
vercel --yes > canary-url.txt

# Route percentage of traffic via load balancer/edge config
# Test with canary URL

# When ready, promote to production
vercel promote $(cat canary-url.txt) --yes
```

### Rollback Procedures

```bash
# Check current rollback status
vercel rollback

# Rollback to previous deployment (Hobby: only 1 back)
vercel rollback

# Rollback to specific deployment (Pro/Enterprise)
vercel rollback https://myapp-previous.vercel.app

# Async rollback (don't wait)
vercel rollback --timeout=0
```

---

## Environment Variable Strategies

### Environment Scoping

```
production   → Live traffic, main branch
preview      → All non-production branches
development  → Local development (vercel dev)
custom       → Named environments (staging, qa)
```

### Adding Variables (Non-Interactive Patterns)

```bash
# From stdin (simple values)
echo "my-value" | vercel env add VAR_NAME production

# From file (multi-line, secrets)
vercel env add PRIVATE_KEY production < ./keys/private.pem

# Branch-specific
vercel env add VAR_NAME preview feature-branch < value.txt

# Multiple environments
for env in production preview development; do
  echo "value" | vercel env add VAR_NAME $env
done
```

### Pulling Variables

```bash
# Development (for local dev)
vercel pull --yes --environment development

# Production (for debugging)
vercel pull --yes --environment production

# Specific branch
vercel pull --yes --environment preview --git-branch feature-1
```

### Variable Best Practices

1. **Use environment-specific values**: Different API keys for prod/preview
2. **Sensitive data**: Use Vercel's encryption, never commit to git
3. **Shared values**: Use same variable name across environments
4. **Branch overrides**: Use git-branch specific values for feature branches

### System Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VERCEL` | Running on Vercel | `1` |
| `VERCEL_ENV` | Environment | `production` |
| `VERCEL_URL` | Deployment URL | `myapp-abc123.vercel.app` |
| `VERCEL_BRANCH_URL` | Branch URL | `myapp-git-main.vercel.app` |
| `VERCEL_REGION` | Function region | `iad1` |
| `VERCEL_GIT_COMMIT_SHA` | Commit SHA | `abc123...` |
| `VERCEL_GIT_COMMIT_REF` | Branch/ref | `main` |
| `VERCEL_GIT_REPO_OWNER` | Repo owner | `my-org` |
| `VERCEL_GIT_REPO_SLUG` | Repo name | `my-app` |

---

## Domain & SSL Management

### Adding Domains

```bash
# Add to project
vercel domains add api.example.com myproject

# Add subdomain
vercel domains add staging.example.com myproject

# Force add (if exists on another project)
vercel domains add api.example.com myproject --force
```

### DNS Configuration

After adding domain, configure DNS:

**For apex domains (example.com)**:
```
Type: A
Value: 76.76.21.21
```

**For subdomains (api.example.com)**:
```
Type: CNAME
Value: cname.vercel-dns.com
```

### SSL Certificates

Vercel auto-provisions Let's Encrypt certificates:

```bash
# List certificates
vercel certs ls

# Issue certificate manually (if needed)
vercel certs issue example.com

# Certificates auto-renew
```

### Wildcard Domains

```bash
# Add wildcard (requires DNS verification)
vercel domains add "*.example.com" myproject
```

---

## Multi-Region Configuration

### Configuring Function Regions

**vercel.json**:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["iad1", "fra1", "hnd1"]
}
```

**CLI**:
```bash
vercel --regions iad1,fra1,hnd1 --yes
```

### Region Failover (Enterprise)

```json
{
  "regions": ["iad1"],
  "functionFailoverRegions": ["sfo1", "fra1"]
}
```

### Region Limits by Plan

| Plan | Max Regions |
|------|-------------|
| Hobby | 1 |
| Pro | 3 |
| Enterprise | Unlimited |

### Choosing Regions

Consider:
1. **User location**: Deploy near your users
2. **Data location**: Deploy near your database
3. **Compliance**: Some regions for GDPR, data residency
4. **Latency**: Test with `vercel httpstat`

---

## CI/CD Integration

### GitHub Actions

**Basic Deployment**:
```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Vercel CLI
        run: npm i -g vercel

      - name: Deploy to Production
        run: vercel --prod --yes --token ${{ secrets.VERCEL_TOKEN }}
```

**Multi-Environment**:
```yaml
name: Deploy

on:
  push:
    branches: [main, develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm i -g vercel

      - name: Deploy Preview (develop)
        if: github.ref == 'refs/heads/develop'
        run: vercel --yes --token ${{ secrets.VERCEL_TOKEN }}

      - name: Deploy Production (main)
        if: github.ref == 'refs/heads/main'
        run: vercel --prod --yes --token ${{ secrets.VERCEL_TOKEN }}
```

**Staged Production with Approval**:
```yaml
name: Staged Production Deploy

on:
  push:
    branches: [main]

jobs:
  stage:
    runs-on: ubuntu-latest
    outputs:
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: actions/checkout@v4
      - run: npm i -g vercel
      - id: deploy
        run: |
          URL=$(vercel --prod --skip-domain --yes --token ${{ secrets.VERCEL_TOKEN }})
          echo "url=$URL" >> $GITHUB_OUTPUT

  promote:
    needs: stage
    runs-on: ubuntu-latest
    environment: production  # Requires approval
    steps:
      - run: npm i -g vercel
      - run: vercel promote ${{ needs.stage.outputs.url }} --yes --token ${{ secrets.VERCEL_TOKEN }}
```

### GitLab CI

```yaml
stages:
  - deploy

deploy:
  stage: deploy
  image: node:18
  script:
    - npm i -g vercel
    - vercel --prod --yes --token $VERCEL_TOKEN
  only:
    - main
```

### CircleCI

```yaml
version: 2.1

jobs:
  deploy:
    docker:
      - image: node:18
    steps:
      - checkout
      - run: npm i -g vercel
      - run: vercel --prod --yes --token $VERCEL_TOKEN

workflows:
  deploy:
    jobs:
      - deploy:
          filters:
            branches:
              only: main
```

### Token Management

Generate tokens at: `https://vercel.com/account/tokens`

**Token Types**:
- **Full Access**: All operations (use sparingly)
- **Git Integration**: Limited to deployments

**Security**:
- Store in CI/CD secrets
- Rotate periodically
- Use minimum required permissions

---

## Monitoring and Observability

### Viewing Logs

```bash
# Real-time logs (up to 5 minutes)
vercel logs <deployment-url>

# JSON format for parsing
vercel logs <url> --json | jq '.message'

# Filter by level
vercel logs <url> --json | jq 'select(.level == "error")'
```

### Log Parsing Examples

```bash
# Extract errors
vercel logs <url> --json | jq -r 'select(.level == "error") | .message'

# Count by level
vercel logs <url> --json | jq -s 'group_by(.level) | map({level: .[0].level, count: length})'

# Extract timestamps
vercel logs <url> --json | jq -r '[.timestamp, .message] | @tsv'
```

### Deployment Inspection

```bash
# Full deployment details
vercel inspect <url>

# JSON format
vercel inspect <url> --json
```

### HTTP Status Check

```bash
# Check endpoint status
vercel httpstat https://myapp.vercel.app

# Specific paths
vercel httpstat https://myapp.vercel.app/api/health
```

### Integration with Monitoring

Vercel integrates with:
- Datadog
- LogDNA
- Sentry
- New Relic

Configure in Project Settings → Integrations.

---

## Security Best Practices

### Token Security

- Never commit tokens to version control
- Use CI/CD secrets management
- Rotate tokens regularly
- Use minimum required scopes

### Environment Variable Security

```bash
# Use encrypted Vercel variables (not .env files)
echo "secret" | vercel env add API_KEY production

# For local dev, pull encrypted values
vercel pull --yes --environment development

# Never commit .env.local
echo ".env.local" >> .gitignore
```

### Access Control

- Use team scopes for projects
- Limit who can deploy to production
- Enable deployment protection
- Use preview deployment comments

### Headers Security

**vercel.json**:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

---

## Troubleshooting Deep Dive

### Build Failures

```bash
# View build logs in deployment
vercel logs <url>

# Inspect deployment for build info
vercel inspect <url>

# Common causes:
# - Missing dependencies
# - Wrong Node.js version
# - Build command errors
# - Environment variable missing
```

### Runtime Errors

```bash
# View function logs
vercel logs <url>

# Filter errors
vercel logs <url> --json | jq 'select(.level == "error")'

# Check function configuration
vercel inspect <url>
```

### Domain Issues

```bash
# Check domain status
vercel domains inspect example.com

# Verify DNS
dig example.com
dig CNAME api.example.com

# Check certificate
vercel certs ls
```

### Environment Variable Issues

```bash
# List current variables
vercel env ls production

# Verify variable exists
vercel env ls production | grep VAR_NAME

# Re-pull after changes
vercel pull --yes --environment production
```

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `DEPLOYMENT_NOT_FOUND` | Invalid URL/ID | Check deployment exists |
| `UNAUTHORIZED` | Invalid token | Regenerate token |
| `DOMAIN_ALREADY_IN_USE` | Domain on other project | Use `--force` |
| `BUILD_FAILED` | Build error | Check logs |
| `FUNCTION_INVOCATION_FAILED` | Runtime error | Check function logs |
| `RATE_LIMIT_EXCEEDED` | Too many requests | Wait and retry |

---

## vercel.json Configuration

### Complete Schema

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "version": 2,
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "devCommand": "npm run dev",
  "regions": ["iad1", "fra1"],
  "functionFailoverRegions": ["sfo1"],
  "functions": {
    "api/**/*.js": {
      "memory": 1024,
      "maxDuration": 30
    }
  },
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/:path*" }
  ],
  "redirects": [
    { "source": "/old", "destination": "/new", "permanent": true }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Custom-Header", "value": "value" }
      ]
    }
  ],
  "cleanUrls": true,
  "trailingSlash": false
}
```

### Framework Detection

Vercel auto-detects frameworks. Override if needed:

```json
{
  "framework": "nextjs"
}
```

Supported: `nextjs`, `gatsby`, `nuxtjs`, `vite`, `create-react-app`, `remix`, `svelte`, `astro`, etc.

### Function Configuration

```json
{
  "functions": {
    "api/**/*.js": {
      "memory": 1024,
      "maxDuration": 30,
      "regions": ["iad1"]
    },
    "api/heavy.js": {
      "memory": 3008,
      "maxDuration": 60
    }
  }
}
```

### Rewrites and Redirects

```json
{
  "rewrites": [
    { "source": "/blog/:slug", "destination": "/posts/:slug" },
    { "source": "/api/:path*", "destination": "https://api.example.com/:path*" }
  ],
  "redirects": [
    { "source": "/old-page", "destination": "/new-page", "permanent": true },
    { "source": "/temp", "destination": "/other", "permanent": false }
  ]
}
```

---

## Cost Optimization

### Function Optimization

- **Cold starts**: Use smaller bundles, fewer dependencies
- **Memory**: Start low (128MB), increase if needed
- **Duration**: Set reasonable `maxDuration` limits
- **Regions**: Use fewer regions unless needed

### Bandwidth Optimization

- Enable compression
- Use CDN caching
- Optimize images (next/image, etc.)
- Lazy load assets

### Build Optimization

- Use build caching
- Exclude unnecessary files
- Optimize dependencies

### Monitoring Costs

- Use Vercel Usage dashboard
- Set up spend alerts
- Review function invocations
- Check bandwidth usage

---

## Quick Troubleshooting Reference

```bash
# General debugging workflow
vercel list                              # 1. Check recent deployments
vercel inspect <url>                     # 2. Inspect deployment details
vercel logs <url>                        # 3. View logs
vercel logs <url> --json | jq            # 4. Parse logs

# Domain debugging
vercel domains inspect <domain>
vercel certs ls
dig <domain>

# Environment debugging
vercel env ls production
vercel pull --yes --environment production

# Authentication debugging
vercel whoami
vercel teams ls
```

---

**Last Updated**: 2025-12-27 | **Version**: 1.0.0
