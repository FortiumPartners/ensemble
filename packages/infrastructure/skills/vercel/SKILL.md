---
name: vercel
description: Vercel platform CLI for frontend deployments, serverless functions, and edge network management. Use for deploying applications, managing domains, environment variables, and debugging deployments.
version: 1.0.0
allowed-tools: Bash, Read, Glob, Grep
---

# Vercel CLI Skill

**Version**: 1.0.0 | **Target**: <25KB | **Purpose**: Fast reference for Vercel CLI operations

---

## Overview

**What is Vercel**: Frontend cloud platform for deploying web applications with automatic CI/CD, serverless functions, edge network, and global CDN. Optimized for Next.js, React, Vue, and other frameworks.

**When to Use This Skill**:
- Deploying frontend applications
- Managing serverless functions
- Configuring domains and SSL certificates
- Managing environment variables
- Debugging deployments and viewing logs
- Promoting/rolling back deployments

**Auto-Detection Triggers**:
- `vercel.json` in project root
- `.vercel` directory present
- `VERCEL_TOKEN` in `.env` file
- User mentions "Vercel", "vercel deploy"

**Progressive Disclosure**:
- **This file (SKILL.md)**: Quick reference for immediate use
- **REFERENCE.md**: Comprehensive guide with advanced patterns

---

## Critical: Avoiding Interactive Mode

**Vercel CLI can enter interactive mode which will hang Claude Code.** Always use flags to bypass prompts:

| Command | WRONG (Interactive) | CORRECT (Non-Interactive) |
|---------|---------------------|---------------------------|
| Deploy | `vercel` | `vercel --yes --token $VERCEL_TOKEN` |
| Link project | `vercel link` | `vercel link --yes --project <name>` |
| Pull env vars | `vercel pull` | `vercel pull --yes --environment production` |
| Add env var | `vercel env add` | `vercel env add NAME production < value.txt` |
| Remove env var | `vercel env rm NAME` | `vercel env rm NAME --yes` |
| Remove domain | `vercel domains rm` | `vercel domains rm <domain> --yes` |
| Remove alias | `vercel alias rm` | `vercel alias rm <domain> --yes` |
| Remove project | `vercel project rm` | `vercel project rm <name> --yes` |
| Promote preview | `vercel promote` | `vercel promote <url> --yes` |

**Required flags for automation**:
- `--yes` / `-y` - Skip confirmation prompts
- `--token <TOKEN>` - Authenticate without `vercel login`
- Explicit project/environment names - Avoid selection menus
- `--no-wait` - Don't wait for deployment completion (for `redeploy`)

**Never use in Claude Code**:
- `vercel login` (use VERCEL_TOKEN instead)
- `vercel dev` (starts interactive dev server)
- Any command without `--yes` when it modifies/removes resources

---

## Table of Contents

1. [Prerequisites & Installation](#prerequisites--installation)
2. [Authentication](#authentication)
3. [CLI Decision Tree](#cli-decision-tree)
4. [Command Reference](#command-reference)
5. [Static Reference Data](#static-reference-data)
6. [Common Workflows](#common-workflows)
7. [Environment Variables](#environment-variables)
8. [Error Handling](#error-handling)
9. [Framework Examples](#framework-examples)
10. [Agent Integration](#agent-integration)

---

## Prerequisites & Installation

### Verify Installation

```bash
# Check CLI installed
vercel --version  # Expects: 30.x.x or higher
```

### Installation Methods

```bash
# npm
npm i -g vercel

# yarn
yarn global add vercel

# pnpm
pnpm i -g vercel

# bun
bun add -g vercel
```

### Update to Latest

```bash
npm i -g vercel@latest
```

---

## Authentication

### Token Types

| Token Type | Env Variable | Scope | Use Cases |
|------------|--------------|-------|-----------|
| Personal Token | `VERCEL_TOKEN` | Full account access | CI/CD, automation |
| Team Token | `VERCEL_TOKEN` | Team-scoped | Team deployments |
| Project Token | `VERCEL_TOKEN` | Project-scoped | Limited project access |

### Authentication Priority (Check in Order)

**IMPORTANT**: Always use token-based auth for automation.

1. **Project `.env`** (PREFERRED - project-specific):
   ```bash
   # Check project .env for VERCEL_TOKEN
   grep VERCEL_TOKEN .env

   # Run commands with project token
   export VERCEL_TOKEN="$(grep VERCEL_TOKEN .env | cut -d= -f2)"
   vercel --token $VERCEL_TOKEN whoami
   ```

2. **Environment Variable** (session):
   ```bash
   export VERCEL_TOKEN="your-token"
   vercel whoami  # Token auto-detected
   ```

3. **Command-line flag** (explicit):
   ```bash
   vercel --token <TOKEN> <command>
   ```

### Running Commands with Token

```bash
# All commands should include --token for automation
vercel --token $VERCEL_TOKEN deploy --yes
vercel --token $VERCEL_TOKEN env ls
vercel --token $VERCEL_TOKEN logs <deployment-url>
```

---

## CLI Decision Tree

### Project Operations

```
User wants to...
├── Link directory to project
│   └── vercel link --yes --project <name>
├── List projects
│   └── vercel project ls
├── Add new project
│   └── vercel project add <name>
├── Remove project
│   └── vercel project rm <name> --yes
├── View current user
│   └── vercel whoami
├── Switch teams
│   └── vercel switch <team-slug>
└── Open project dashboard
    └── vercel open
```

### Deployment Operations

```
User wants to...
├── Deploy to preview
│   └── vercel --yes
├── Deploy to production
│   └── vercel --prod --yes
├── Deploy without domain assignment
│   └── vercel --prod --skip-domain --yes
├── Deploy prebuilt output
│   └── vercel deploy --prebuilt --yes
├── Redeploy existing
│   └── vercel redeploy <url> --no-wait
├── Promote to production
│   └── vercel promote <url> --yes
├── Rollback deployment
│   └── vercel rollback <url>
├── List deployments
│   └── vercel list [project]
├── Inspect deployment
│   └── vercel inspect <url>
└── Remove deployment
    └── vercel remove <url> --yes
```

### Environment Variable Operations

```
User wants to...
├── List env vars
│   └── vercel env ls [environment]
├── Add env var
│   └── echo "value" | vercel env add NAME production
├── Add from file
│   └── vercel env add NAME production < secret.txt
├── Remove env var
│   └── vercel env rm NAME --yes
├── Pull to local file
│   └── vercel env pull --yes
└── Pull specific environment
    └── vercel pull --yes --environment production
```

### Domain Operations

```
User wants to...
├── List domains
│   └── vercel domains ls
├── Add domain
│   └── vercel domains add <domain> [project]
├── Add domain (force)
│   └── vercel domains add <domain> <project> --force
├── Remove domain
│   └── vercel domains rm <domain> --yes
├── Inspect domain
│   └── vercel domains inspect <domain>
└── Move domain
    └── vercel domains move <domain> <scope>
```

### Alias Operations

```
User wants to...
├── List aliases
│   └── vercel alias ls
├── Set alias
│   └── vercel alias set <deployment-url> <domain>
└── Remove alias
    └── vercel alias rm <domain> --yes
```

### Debugging Operations

```
User wants to...
├── View logs
│   └── vercel logs <deployment-url>
├── View logs as JSON
│   └── vercel logs <deployment-url> --json
├── Inspect deployment
│   └── vercel inspect <deployment-url>
└── Check HTTP status
    └── vercel httpstat <url>
```

---

## Command Reference

### Project Management

| Command | Description | Example |
|---------|-------------|---------|
| `vercel link` | Link directory to project | `vercel link --yes --project myapp` |
| `vercel project ls` | List projects | `vercel project ls --json` |
| `vercel project add` | Create project | `vercel project add myapp` |
| `vercel project rm` | Delete project | `vercel project rm myapp --yes` |
| `vercel whoami` | Show current user | `vercel whoami` |
| `vercel switch` | Switch teams | `vercel switch my-team` |
| `vercel teams ls` | List teams | `vercel teams ls` |
| `vercel open` | Open dashboard | `vercel open` |

### Deployment Commands

| Command | Description | Example |
|---------|-------------|---------|
| `vercel` | Deploy to preview | `vercel --yes` |
| `vercel --prod` | Deploy to production | `vercel --prod --yes` |
| `vercel deploy` | Deploy (explicit) | `vercel deploy --yes` |
| `vercel redeploy` | Redeploy existing | `vercel redeploy <url> --no-wait` |
| `vercel promote` | Promote to production | `vercel promote <url> --yes` |
| `vercel rollback` | Rollback deployment | `vercel rollback <url>` |
| `vercel list` | List deployments | `vercel list --json` |
| `vercel inspect` | Inspect deployment | `vercel inspect <url>` |
| `vercel remove` | Remove deployment | `vercel remove <url> --yes` |

### Environment Variables

| Command | Description | Example |
|---------|-------------|---------|
| `vercel env ls` | List variables | `vercel env ls production` |
| `vercel env add` | Add variable | `echo "val" \| vercel env add KEY prod` |
| `vercel env rm` | Remove variable | `vercel env rm KEY --yes` |
| `vercel env pull` | Pull to .env | `vercel env pull --yes` |
| `vercel pull` | Pull settings + env | `vercel pull --yes --environment prod` |

### Domain Management

| Command | Description | Example |
|---------|-------------|---------|
| `vercel domains ls` | List domains | `vercel domains ls --limit 100` |
| `vercel domains add` | Add domain | `vercel domains add api.example.com myapp` |
| `vercel domains rm` | Remove domain | `vercel domains rm api.example.com --yes` |
| `vercel domains inspect` | Inspect domain | `vercel domains inspect example.com` |
| `vercel domains move` | Move domain | `vercel domains move example.com other-team` |

### Alias Management

| Command | Description | Example |
|---------|-------------|---------|
| `vercel alias ls` | List aliases | `vercel alias ls --limit 100` |
| `vercel alias set` | Set alias | `vercel alias set <deploy-url> custom.com` |
| `vercel alias rm` | Remove alias | `vercel alias rm custom.com --yes` |

### Debugging Commands

| Command | Description | Example |
|---------|-------------|---------|
| `vercel logs` | View runtime logs | `vercel logs <url>` |
| `vercel logs --json` | Logs as JSON | `vercel logs <url> --json \| jq` |
| `vercel inspect` | Deployment details | `vercel inspect <url>` |
| `vercel httpstat` | HTTP status check | `vercel httpstat https://myapp.vercel.app` |

### DNS Management

| Command | Description | Example |
|---------|-------------|---------|
| `vercel dns ls` | List DNS records | `vercel dns ls example.com` |
| `vercel dns add` | Add DNS record | `vercel dns add example.com A 1.2.3.4` |
| `vercel dns rm` | Remove DNS record | `vercel dns rm <record-id>` |

### Certificate Management

| Command | Description | Example |
|---------|-------------|---------|
| `vercel certs ls` | List certificates | `vercel certs ls` |
| `vercel certs issue` | Issue certificate | `vercel certs issue example.com` |
| `vercel certs rm` | Remove certificate | `vercel certs rm example.com` |

---

## Static Reference Data

### Deployment Regions (19 Compute Regions)

| Code | Location | AWS Region |
|------|----------|------------|
| `arn1` | Stockholm, Sweden | eu-north-1 |
| `bom1` | Mumbai, India | ap-south-1 |
| `cdg1` | Paris, France | eu-west-3 |
| `cle1` | Cleveland, USA | us-east-2 |
| `cpt1` | Cape Town, South Africa | af-south-1 |
| `dub1` | Dublin, Ireland | eu-west-1 |
| `dxb1` | Dubai, UAE | me-central-1 |
| `fra1` | Frankfurt, Germany | eu-central-1 |
| `gru1` | Sao Paulo, Brazil | sa-east-1 |
| `hkg1` | Hong Kong | ap-east-1 |
| `hnd1` | Tokyo, Japan | ap-northeast-1 |
| `iad1` | Washington DC, USA (default) | us-east-1 |
| `icn1` | Seoul, South Korea | ap-northeast-2 |
| `kix1` | Osaka, Japan | ap-northeast-3 |
| `lhr1` | London, UK | eu-west-2 |
| `pdx1` | Portland, USA | us-west-2 |
| `sfo1` | San Francisco, USA | us-west-1 |
| `sin1` | Singapore | ap-southeast-1 |
| `syd1` | Sydney, Australia | ap-southeast-2 |

**Default Region**: `iad1` (Washington DC)
**Edge Network**: 126 PoPs in 94 cities across 51 countries

### Environment Types

| Environment | Description | Use Case |
|-------------|-------------|----------|
| `production` | Live production | Main branch deployments |
| `preview` | Preview deployments | PR/branch previews |
| `development` | Local development | `vercel dev`, `vercel pull` |
| Custom | Custom environments | `staging`, `qa`, etc. |

### Plan Limits

| Feature | Hobby | Pro | Enterprise |
|---------|-------|-----|------------|
| Function Regions | 1 | 3 | Unlimited |
| Rollback History | 1 | All | All |
| Custom Domains | 50 | 50 | Unlimited |
| Environment Variables | 100 | 100 | Unlimited |

---

## Common Workflows

**All commands use non-interactive flags for Claude Code compatibility.**

### 1. Initial Project Setup

```bash
# Link existing project (ALWAYS use --yes and --project)
vercel link --yes --project myapp

# Or create new project
vercel project add myapp

# Pull environment variables
vercel pull --yes --environment development
```

### 2. Deploy Application

```bash
# Deploy to preview (ALWAYS use --yes)
vercel --yes

# Deploy to production
vercel --prod --yes

# Deploy without waiting
vercel --yes > deployment-url.txt
```

### 3. Production Deployment with Staging

```bash
# Deploy to preview first (staged production)
vercel --prod --skip-domain --yes > staged-url.txt

# Test the staged deployment, then promote
vercel promote $(cat staged-url.txt) --yes
```

### 4. Manage Environment Variables

```bash
# List all variables for production
vercel env ls production

# Add variable (use echo pipe to avoid interactive)
echo "my-secret-value" | vercel env add API_KEY production

# Add from file (for multi-line values)
vercel env add PRIVATE_KEY production < ./private-key.pem

# Remove variable (ALWAYS use --yes)
vercel env rm OLD_KEY --yes

# Pull variables to local .env
vercel env pull --yes
```

### 5. Domain Configuration

```bash
# Add domain to project
vercel domains add api.example.com myapp

# If domain exists on another project, force add
vercel domains add api.example.com myapp --force

# Remove domain (ALWAYS use --yes)
vercel domains rm api.example.com --yes
```

### 6. Debug Failing Deployment

```bash
# View runtime logs
vercel logs <deployment-url>

# View logs as JSON for parsing
vercel logs <deployment-url> --json | jq '.message'

# Inspect deployment details
vercel inspect <deployment-url>

# List recent deployments
vercel list --json | jq '.[0:5]'
```

### 7. Rollback Deployment

```bash
# Check rollback status
vercel rollback

# Rollback to specific deployment
vercel rollback <deployment-url>

# For Pro: rollback to any previous deployment
vercel rollback <older-deployment-url>
```

### 8. CI/CD Deployment

```bash
# In CI (uses VERCEL_TOKEN env var)
export VERCEL_TOKEN=${{ secrets.VERCEL_TOKEN }}
vercel --prod --yes
```

---

## Environment Variables

### Variable Scopes

Variables can be scoped to:
- **Production**: Only production deployments
- **Preview**: Preview/branch deployments
- **Development**: Local development (`vercel dev`)
- **All**: All environments

### Adding Variables (Non-Interactive)

```bash
# Add to production only
echo "value" | vercel env add VAR_NAME production

# Add to all environments (specify each)
echo "value" | vercel env add VAR_NAME production
echo "value" | vercel env add VAR_NAME preview
echo "value" | vercel env add VAR_NAME development

# Add from file (for secrets/keys)
vercel env add PRIVATE_KEY production < key.pem

# Add to specific git branch
vercel env add VAR_NAME preview feature-branch < value.txt
```

### Pulling Variables

```bash
# Pull development variables to .env.local
vercel pull --yes --environment development

# Pull production variables
vercel pull --yes --environment production

# Pull to specific file
vercel env pull .env.production --yes
```

### Vercel System Variables

| Variable | Description |
|----------|-------------|
| `VERCEL` | Always `1` when running on Vercel |
| `VERCEL_ENV` | `production`, `preview`, or `development` |
| `VERCEL_URL` | Deployment URL (without protocol) |
| `VERCEL_BRANCH_URL` | Branch-specific URL |
| `VERCEL_REGION` | Region code (e.g., `iad1`) |
| `VERCEL_GIT_COMMIT_SHA` | Git commit SHA |
| `VERCEL_GIT_COMMIT_REF` | Git branch/ref |
| `VERCEL_GIT_REPO_OWNER` | Repository owner |
| `VERCEL_GIT_REPO_SLUG` | Repository name |

---

## Error Handling

### Common Errors and Resolutions

| Error | Cause | Resolution |
|-------|-------|------------|
| `command not found: vercel` | CLI not installed | `npm i -g vercel` |
| `Not authorized` | Missing/invalid token | Check VERCEL_TOKEN |
| `Project not found` | Wrong project name | `vercel project ls` to list |
| `No project linked` | Directory not linked | `vercel link --yes --project <name>` |
| `Domain already in use` | Domain on other project | Use `--force` flag |
| `Deployment failed` | Build error | Check `vercel logs` |
| `Rate limit exceeded` | Too many requests | Wait, implement backoff |

### Authentication Troubleshooting

```bash
# Verify authentication
vercel whoami

# Check token validity
vercel --token $VERCEL_TOKEN whoami

# List available teams
vercel teams ls
```

### Deployment Troubleshooting

```bash
# View deployment logs
vercel logs <deployment-url>

# View logs as JSON
vercel logs <deployment-url> --json

# Inspect deployment details
vercel inspect <deployment-url>

# List recent deployments
vercel list
```

### Graceful Fallback

If CLI unavailable, provide web URLs:
- Dashboard: `https://vercel.com/dashboard`
- Project: `https://vercel.com/<team>/<project>`
- Deployment: `https://vercel.com/<team>/<project>/<deployment-id>`
- Docs: `https://vercel.com/docs`

---

## Framework Examples

### Next.js

**vercel.json** (optional - auto-detected):
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["iad1", "sfo1"]
}
```

### React (Vite/CRA)

**vercel.json**:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

### Vue/Nuxt

**vercel.json**:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nuxtjs",
  "regions": ["fra1"]
}
```

### Static Site

**vercel.json**:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "outputDirectory": "public"
}
```

### Multi-Region Functions

**vercel.json**:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["iad1", "fra1", "hnd1"],
  "functionFailoverRegions": ["sfo1", "lhr1"]
}
```

---

## Agent Integration

### Auto-Detection (No Slash Command)

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

### Pattern Recognition

```yaml
High-confidence triggers:
  - "Deploy to Vercel"
  - "Check Vercel deployment"
  - "vercel deploy"
  - "Vercel logs"
  - "Add domain to Vercel"
  - "Vercel environment variables"
  - "Promote Vercel deployment"
  - "Rollback Vercel"

Medium-confidence triggers:
  - "Deploy frontend"
  - "Check deployment status"
  - "Add custom domain"
  - "Next.js deployment"
```

### Handoff to Deep-Debugger

```yaml
When to handoff:
  - Build failures with unclear errors
  - Runtime errors in serverless functions
  - Performance issues requiring profiling
  - Edge function debugging

Provide context:
  - vercel logs output
  - vercel inspect output
  - Relevant error messages
  - vercel.json configuration
```

### JSON Output Mode

Most commands support `--json` for programmatic parsing:

```bash
vercel list --json | jq '.[0].url'
vercel logs <url> --json | jq -r '.message'
vercel domains ls --json | jq '.[].name'
```

---

## Quick Reference Card (Non-Interactive)

```bash
# Authentication (NEVER use vercel login in Claude Code)
export VERCEL_TOKEN="xxx"
vercel --token $VERCEL_TOKEN whoami

# Project (ALWAYS use --yes)
vercel link --yes --project myapp
vercel project ls
vercel project rm myapp --yes

# Deploy (ALWAYS use --yes)
vercel --yes                              # Preview
vercel --prod --yes                       # Production
vercel --prod --skip-domain --yes         # Staged production
vercel promote <url> --yes                # Promote staged

# Redeploy/Rollback
vercel redeploy <url> --no-wait
vercel rollback <url>

# Environment Variables
vercel env ls production
echo "value" | vercel env add KEY production
vercel env rm KEY --yes
vercel pull --yes --environment production

# Domains (ALWAYS use --yes for rm)
vercel domains ls
vercel domains add api.example.com myapp
vercel domains rm api.example.com --yes

# Debugging
vercel logs <deployment-url>
vercel logs <url> --json | jq '.message'
vercel inspect <url>
vercel list --json
```

---

**Progressive Disclosure**: Start here for quick reference. Load REFERENCE.md for comprehensive patterns, advanced configurations, and troubleshooting deep-dives.

**Last Updated**: 2025-12-27 | **Version**: 1.0.0
