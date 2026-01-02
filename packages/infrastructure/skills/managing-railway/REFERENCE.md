# Railway CLI Reference Guide

**Version**: 1.0.0 | **Target**: <50KB | **Purpose**: Comprehensive reference for Railway CLI operations

---

## Critical: Non-Interactive Mode

**All commands in this reference use non-interactive flags.** Railway CLI can enter interactive mode which will hang Claude Code agents.

**Required patterns**:
- Always use `-y` / `--yes` for confirmation prompts
- Always use `--detach` for `railway up` commands
- Always specify explicit names/IDs (never rely on interactive selection)
- Use `railway ssh -- <command>` (never open interactive SSH shell)
- Use `RAILWAY_TOKEN` environment variable (never `railway login`)
- Avoid `railway connect` and `railway shell` (both open interactive shells)

---

## Table of Contents

1. [Complete Command Documentation](#complete-command-documentation)
2. [Advanced Deployment Patterns](#advanced-deployment-patterns)
3. [Volume Management](#volume-management)
4. [Environment Variable Strategies](#environment-variable-strategies)
5. [Networking Deep Dive](#networking-deep-dive)
6. [Multi-Environment Setup](#multi-environment-setup)
7. [CI/CD Integration](#cicd-integration)
8. [Monitoring and Observability](#monitoring-and-observability)
9. [Security Best Practices](#security-best-practices)
10. [Troubleshooting Deep Dive](#troubleshooting-deep-dive)
11. [Config as Code](#config-as-code)
12. [Cost Optimization](#cost-optimization)

---

## Complete Command Documentation

### railway add

Add a service to your project.

```bash
railway add [OPTIONS]

OPTIONS:
  -d, --database <DATABASE>   Add database (postgres, mysql, redis, mongo)
  -s, --service <NAME>        Name for the new service
  -r, --repo <REPO>           Link GitHub repository (owner/repo)
  -i, --image <IMAGE>         Deploy Docker image
  -v, --variables <VARS>      Set environment variables (KEY=value,KEY2=value2)

EXAMPLES:
  railway add -d postgres                      # Add PostgreSQL database
  railway add -d redis -s cache               # Add Redis named "cache"
  railway add -r myorg/myapp                  # Add service from repo
  railway add -i nginx:latest -s proxy        # Add from Docker image
  railway add -s api -v PORT=3000,NODE_ENV=production
```

### railway completion

Generate shell completion scripts.

```bash
railway completion <SHELL>

SHELLS:
  bash, elvish, fish, powershell, zsh

EXAMPLES:
  # Bash
  railway completion bash > ~/.local/share/bash-completion/completions/railway

  # Zsh
  railway completion zsh > ~/.zsh/completions/_railway

  # Fish
  railway completion fish > ~/.config/fish/completions/railway.fish
```

### railway connect

Connect to a database's shell.

```bash
railway connect [SERVICE_NAME] [OPTIONS]

OPTIONS:
  -e, --environment <ENV>    Environment to connect to

EXAMPLES:
  railway connect                    # Connect to default database
  railway connect postgres           # Connect to specific service
  railway connect -e staging         # Connect in staging environment
```

**Database Shells**:
- PostgreSQL → `psql`
- MySQL → `mysql`
- Redis → `redis-cli`
- MongoDB → `mongosh`

### railway deploy

Provision a template into your project.

```bash
railway deploy [OPTIONS]

OPTIONS:
  -t, --template <TEMPLATE>           Template to deploy
  -v, --variable <service.VAR=value>  Set service-prefixed variable

EXAMPLES:
  railway deploy -t postgres
  railway deploy -t redis
  railway deploy -t postgres -v postgres.POSTGRES_DB=myapp
```

### railway domain

Generate or add a domain for a service.

```bash
railway domain [DOMAIN] [OPTIONS]

OPTIONS:
  -p, --port <PORT>       Target port
  -s, --service <SERVICE> Service to add domain to

EXAMPLES:
  railway domain                          # Generate Railway domain
  railway domain -p 8080                  # Specify target port
  railway domain api.myapp.com            # Add custom domain
  railway domain api.myapp.com -p 3000 -s api
```

### railway down

Remove the most recent deployment.

```bash
railway down [OPTIONS]

OPTIONS:
  -y, --yes    Skip confirmation prompt

EXAMPLES:
  railway down       # Prompts for confirmation
  railway down -y    # No confirmation
```

### railway environment

Manage environments.

```bash
railway environment [ENVIRONMENT] [SUBCOMMAND]

SUBCOMMANDS:
  new      Create new environment
  delete   Delete environment

EXAMPLES:
  railway environment                     # List/select environment
  railway environment staging             # Switch to staging
  railway environment new                 # Create new environment
  railway environment new -d production   # Duplicate from production
  railway environment delete staging -y   # Delete staging
```

**environment new options**:
```bash
railway environment new [OPTIONS]

OPTIONS:
  -d, --duplicate <ENV>                  Duplicate from existing environment
  -v, --service-variable <svc.VAR=val>   Set service variable
```

### railway init

Create a new project.

```bash
railway init [OPTIONS]

OPTIONS:
  -n, --name <NAME>          Project name
  -w, --workspace <WORKSPACE> Workspace/team to create in

EXAMPLES:
  railway init                          # Interactive creation
  railway init -n myproject             # Named project
  railway init -n myapp -w my-team      # In specific workspace
```

### railway link

Associate existing project with current directory.

```bash
railway link [OPTIONS]

OPTIONS:
  -e, --environment <ENV>    Link to specific environment
  -p, --project <PROJECT>    Project ID or name
  -s, --service <SERVICE>    Link to specific service
  -t, --team <TEAM>          Team/workspace

EXAMPLES:
  railway link                              # Interactive linking
  railway link -p myproject                 # Link to project
  railway link -p myproject -e production   # Specific environment
  railway link -p myproject -s api          # Specific service
```

### railway list

List all projects in your Railway account.

```bash
railway list

OUTPUT:
  Project ID | Project Name | Team
```

### railway login / logout

Authentication management.

```bash
railway login [OPTIONS]
railway logout

OPTIONS:
  -b, --browserless    Use pairing code instead of browser

EXAMPLES:
  railway login              # Opens browser for OAuth
  railway login --browserless  # Displays pairing code
  railway logout             # Clear credentials
```

### railway logs

View deployment logs.

```bash
railway logs [OPTIONS]

OPTIONS:
  -d, --deployment <ID>    Specific deployment
  -b, --build              Show build logs instead of runtime

EXAMPLES:
  railway logs              # Current deployment logs
  railway logs -b           # Build logs
  railway logs -d abc123    # Specific deployment
```

### railway open

Open project dashboard in browser.

```bash
railway open
```

### railway redeploy

Redeploy the latest deployment.

```bash
railway redeploy [OPTIONS]

OPTIONS:
  -s, --service <SERVICE>   Service to redeploy
  -y, --yes                 Skip confirmation

EXAMPLES:
  railway redeploy           # Redeploy with confirmation
  railway redeploy -y        # Skip confirmation
  railway redeploy -s api -y # Redeploy specific service
```

### railway run

Run a local command using Railway environment variables.

```bash
railway run [OPTIONS] <COMMAND>

OPTIONS:
  -s, --service <SERVICE>      Service to get variables from
  -e, --environment <ENV>      Environment to use

EXAMPLES:
  railway run npm start                    # Run with all vars
  railway run -s api npm start             # From specific service
  railway run node scripts/migrate.js      # Run migration
  railway run printenv                     # Show all vars
```

### railway service

Link a service to the current project.

```bash
railway service [SERVICE]

EXAMPLES:
  railway service            # Interactive selection
  railway service api        # Link to "api" service
```

### railway shell

Open a local subshell with Railway variables available.

```bash
railway shell [OPTIONS]

OPTIONS:
  -s, --service <SERVICE>    Service to get variables from

EXAMPLES:
  railway shell              # Interactive shell with vars
  railway shell -s api       # Shell with api service vars
```

### railway ssh

Establish SSH connection to service.

```bash
railway ssh [OPTIONS] [COMMAND]...

OPTIONS:
  -p, --project <PROJECT>              Project ID
  -s, --service <SERVICE>              Service name
  -e, --environment <ENV>              Environment
  -d, --deployment-instance <INSTANCE> Specific deployment instance

EXAMPLES:
  railway ssh                          # Interactive SSH
  railway ssh -s api                   # SSH to api service
  railway ssh -- ls -la                # Run single command
  railway ssh -- cat /app/logs/app.log # View log file
  railway ssh -- ps aux                # List processes
```

**Limitations**:
- No file transfer (SCP/SFTP)
- No tunneling or port forwarding
- Requires active service with shell

### railway status

Show information about current project and user.

```bash
railway status [OPTIONS]

OPTIONS:
  --json    Output as JSON

OUTPUT:
  - Project name and ID
  - Environment
  - Services and their status
  - Recent deployments
```

### railway unlink

Remove current directory association.

```bash
railway unlink [OPTIONS]

OPTIONS:
  -s, --service <SERVICE>    Unlink specific service only

EXAMPLES:
  railway unlink             # Unlink entire project
  railway unlink -s api      # Unlink only api service
```

### railway up

Upload and deploy directory to project.

```bash
railway up [OPTIONS] [PATH]

OPTIONS:
  -d, --detach           Don't wait for deployment
  -c, --ci               Run in CI mode
  -s, --service <SVC>    Deploy to specific service
  -e, --environment <ENV> Deploy to specific environment
  --no-gitignore         Don't respect .gitignore
  --verbose              Verbose output

EXAMPLES:
  railway up                      # Deploy current directory
  railway up --detach             # Deploy without waiting
  railway up -s api               # Deploy to api service
  railway up ./backend -s api     # Deploy specific path
  railway up -c                   # CI mode (non-interactive)
```

### railway variables

Show or set environment variables.

```bash
railway variables [OPTIONS]

OPTIONS:
  -s, --service <SERVICE>      Service to target
  -e, --environment <ENV>      Environment to target
  -k, --kv                     Output as KEY=value format
  --set <KEY=value>            Set a variable

EXAMPLES:
  railway variables                        # Show all variables
  railway variables -k                     # KEY=value format
  railway variables --set API_KEY=xxx      # Set variable
  railway variables -s api --set PORT=3000 # Set for service
```

### railway volume

Manage project volumes.

```bash
railway volume <SUBCOMMAND> [OPTIONS]

SUBCOMMANDS:
  list     List all volumes
  add      Add new volume
  delete   Delete volume
  update   Update volume
  attach   Attach volume to service
  detach   Detach volume from service

OPTIONS:
  -s, --service <SERVICE>    Target service
  -e, --environment <ENV>    Target environment

EXAMPLES:
  railway volume list
  railway volume add -s api
  railway volume attach -s api
  railway volume detach -s api
  railway volume delete
```

### railway whoami

Display current authenticated user.

```bash
railway whoami

OUTPUT:
  - Username
  - Email
  - Account type
```

---

## Advanced Deployment Patterns

### Zero-Downtime Deployments

Railway performs rolling deployments by default:

1. New deployment starts alongside existing
2. Health checks validate new deployment
3. Traffic shifts to new deployment
4. Old deployment terminates

**Ensure health checks pass quickly**:
```javascript
// Express health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});
```

### Blue-Green Deployments

Use environments for blue-green:

```bash
# Deploy to staging first
railway environment staging
railway up

# Test staging thoroughly
# Then promote to production
railway environment production
railway up
```

### Rollback Procedures

```bash
# View recent deployments
railway status

# Redeploy specific previous deployment (via dashboard)
# Or use railway.json to pin specific commit/version
```

### Release Commands

Execute commands before deployment goes live (e.g., migrations):

**railway.json**:
```json
{
  "deploy": {
    "releaseCommand": "npm run migrate"
  }
}
```

**Common release commands**:
```bash
# Node.js
"releaseCommand": "npx prisma migrate deploy"

# Rails
"releaseCommand": "bundle exec rails db:migrate"

# Django
"releaseCommand": "python manage.py migrate"
```

### Health Checks

Configure health checks in railway.json:

```json
{
  "deploy": {
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100
  }
}
```

---

## Volume Management

### Volume Basics

Volumes provide persistent storage that survives deployments.

```bash
# Create volume
railway volume add -s api

# List volumes
railway volume list

# Attach to service
railway volume attach -s api

# Detach from service
railway volume detach -s api
```

### Volume Limitations

- **Metal regions**: Volumes not supported on Metal regions
- **Region migration**: Volumes must migrate with service (may cause downtime)
- **Single attachment**: Volume can only attach to one service at a time

### Volume Use Cases

**Database data** (PostgreSQL, MongoDB):
```bash
# Railway databases auto-manage volumes
railway add -d postgres
```

**File uploads**:
```bash
# Add volume for uploads
railway volume add -s api

# Mount at /uploads in service
```

**Cache/temp storage**:
- Consider Redis instead for better performance
- Volumes persist across restarts

### Volume Migration

When changing regions with volumes:

```bash
# 1. Backup data first
railway ssh -- pg_dump > backup.sql

# 2. Change region in dashboard (causes downtime)

# 3. Restore data if needed
railway ssh -- psql < backup.sql
```

---

## Environment Variable Strategies

### Variable Types

| Type | Scope | Configuration |
|------|-------|---------------|
| Service Variables | Single service | Service → Variables tab |
| Shared Variables | All services in project | Project Settings → Shared Variables |
| Reference Variables | Dynamic references | `${{ service.VAR }}` syntax |
| Sealed Variables | Hidden/secured | Cannot be viewed after setting |

### Service Variables

```bash
# Set via CLI
railway variables --set DATABASE_URL=postgres://...
railway variables --set API_KEY=xxx -s api

# View variables
railway variables
railway variables -s api
railway variables -k  # KEY=value format
```

### Shared Variables

Reduce duplication across services:

1. Dashboard → Project Settings → Shared Variables
2. Create: `DATABASE_URL`, `REDIS_URL`, etc.
3. Reference in services: `${{ shared.DATABASE_URL }}`

### Reference Variables

Dynamic references between services:

```bash
# Reference another service's variable
BACKEND_URL=http://${{ api.RAILWAY_PRIVATE_DOMAIN }}:${{ api.PORT }}

# Reference shared variable
DATABASE_URL=${{ shared.DATABASE_URL }}

# Self-reference
FULL_URL=https://${{ RAILWAY_PUBLIC_DOMAIN }}
```

**Important**: Referenced `PORT` must be manually set; it doesn't auto-resolve.

### Sealed Variables

For sensitive data that shouldn't be viewable:

1. Set variable in dashboard
2. Click "Seal" to make permanent
3. Cannot be unsealed or retrieved

**Limitations**:
- Cannot view value after sealing
- Not available in PR environments
- Not included in environment duplications
- Not accessible via CLI

### Variable Priority

1. Service variables (highest)
2. Shared variables
3. Railway-provided variables
4. Build-time variables

---

## Networking Deep Dive

### Public Networking

#### Domain Generation

```bash
# Generate Railway subdomain
railway domain
# Result: myapp-production.up.railway.app

# Specify port
railway domain -p 8080
```

#### Custom Domains

```bash
# Add custom domain
railway domain api.myapp.com

# Configure DNS:
# CNAME: api.myapp.com → myapp-production.up.railway.app
```

**SSL Certificates**: Auto-provisioned via Let's Encrypt once DNS validates.

#### Plan Limits

| Plan | Domains per Service |
|------|---------------------|
| Trial | 1 |
| Hobby | 2 |
| Pro | 20 |

### Private Networking

#### Internal DNS

Format: `<service-name>.railway.internal`

```bash
# Access api service internally
http://api.railway.internal:3000
```

#### IPv4/IPv6 Configuration

**New environments** (post-October 2025): Dual-stack (IPv4 + IPv6)
**Legacy environments**: IPv6 only

**Configure apps to listen on all interfaces**:

```javascript
// Node.js - listen on ::
app.listen(port, '::', callback);

// Express
app.listen(port, '::');
```

```python
# Python/Gunicorn
gunicorn --bind "[::]:8000" app:app

# Python/uvicorn
uvicorn main:app --host :: --port 8000
```

```bash
# Procfile
web: gunicorn --bind "[::]:${PORT:-8000}" app:app
```

#### Library Configurations

**ioredis**:
```javascript
const redis = new Redis(process.env.REDIS_URL + '?family=0');
// OR
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  family: 0  // 0 = dual-stack
});
```

**BullMQ**:
```javascript
const queue = new Queue('myqueue', {
  connection: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    family: 0
  }
});
```

**MongoDB Docker**:
```bash
mongod --ipv6 --bind_ip ::,0.0.0.0
```

### TCP Proxy

For non-HTTP services (databases, custom protocols):

1. Dashboard → Service → Settings → Networking
2. Enable TCP Proxy
3. Specify target port
4. Use provided `RAILWAY_TCP_PROXY_PORT`

```bash
# External access to database
psql -h myapp.railway.app -p $RAILWAY_TCP_PROXY_PORT -U user dbname
```

---

## Multi-Environment Setup

### Environment Strategy

```
production  → Live traffic, protected
staging     → QA/testing, mirrors production
development → Feature development
pr-123      → Pull request preview
```

### Creating Environments

```bash
# Create from scratch
railway environment new

# Duplicate existing (copies variables and services)
railway environment new -d production

# With service variables
railway environment new -v api.DEBUG=true
```

### Switching Environments

```bash
# Interactive selection
railway environment

# Direct switch
railway environment staging
railway environment production
```

### Environment-Specific Variables

```bash
# Switch to environment first
railway environment staging

# Set staging-specific values
railway variables --set DEBUG=true
railway variables --set LOG_LEVEL=debug
railway variables --set DATABASE_URL=postgres://staging-db/...
```

### PR Environments

Railway can auto-create environments for pull requests:

1. Enable in Project Settings → Environments
2. Each PR gets isolated environment
3. Auto-destroyed on PR close

---

## CI/CD Integration

### GitHub Actions

**All examples use non-interactive flags for automation compatibility.**

#### Basic Deployment

```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm i -g @railway/cli

      - name: Deploy
        run: railway up --detach  # ALWAYS use --detach
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}  # Token auth, not login
```

#### Multi-Environment

```yaml
name: Deploy

on:
  push:
    branches:
      - main
      - develop

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm i -g @railway/cli

      - name: Deploy to Staging
        if: github.ref == 'refs/heads/develop'
        run: railway up --detach -e staging  # Explicit environment
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_STAGING }}

      - name: Deploy to Production
        if: github.ref == 'refs/heads/main'
        run: railway up --detach -e production  # Explicit environment
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_PRODUCTION }}
```

#### Docker Container

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    container: ghcr.io/railwayapp/cli:latest
    env:
      RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - run: railway up --detach  # Non-blocking
```

#### With Redeploy

```yaml
jobs:
  redeploy:
    runs-on: ubuntu-latest
    steps:
      - name: Install Railway CLI
        run: npm i -g @railway/cli

      - name: Redeploy Service
        run: railway redeploy -y -s api  # -y skips confirmation
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

### GitLab CI

```yaml
deploy:
  image: ghcr.io/railwayapp/cli:latest
  script:
    - railway up --detach
  only:
    - main
  variables:
    RAILWAY_TOKEN: $RAILWAY_TOKEN
```

### CircleCI

```yaml
version: 2.1

jobs:
  deploy:
    docker:
      - image: ghcr.io/railwayapp/cli:latest
    steps:
      - checkout
      - run: railway up --detach
    environment:
      RAILWAY_TOKEN: ${RAILWAY_TOKEN}

workflows:
  deploy:
    jobs:
      - deploy:
          filters:
            branches:
              only: main
```

### Token Management

**Project Tokens** (RAILWAY_TOKEN):
- Scoped to single project
- Can deploy, view logs, redeploy
- Cannot create projects or list all

**Account Tokens** (RAILWAY_API_TOKEN):
- Full account access
- Can create projects, list all
- Use for initial setup scripts

```bash
# Generate tokens in Railway dashboard
# Project Settings → Tokens → Create Token
```

---

## Monitoring and Observability

### Viewing Logs

```bash
# Real-time logs
railway logs

# Build logs
railway logs -b

# Specific deployment
railway logs -d <deployment-id>

# JSON format for parsing
railway logs --json
```

### Log Parsing

```bash
# Filter errors
railway logs | grep -i error

# JSON parsing with jq
railway logs --json | jq -r '.message'

# Extract specific fields
railway logs --json | jq -r 'select(.level == "error") | .message'
```

### Status Monitoring

```bash
# Current status
railway status

# JSON for automation
railway status --json | jq '.services'
```

### SSH Debugging

```bash
# Interactive shell
railway ssh

# Run diagnostic commands
railway ssh -- ps aux
railway ssh -- df -h
railway ssh -- free -m
railway ssh -- cat /proc/meminfo

# Check application logs
railway ssh -- ls /app/logs/
railway ssh -- tail -100 /app/logs/app.log

# Check environment
railway ssh -- printenv | sort
```

### Health Check Monitoring

Configure health endpoints:

```json
{
  "deploy": {
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100
  }
}
```

```javascript
// Comprehensive health check
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {}
  };

  try {
    // Database check
    await db.raw('SELECT 1');
    health.checks.database = 'ok';
  } catch (e) {
    health.checks.database = 'error';
    health.status = 'degraded';
  }

  try {
    // Redis check
    await redis.ping();
    health.checks.redis = 'ok';
  } catch (e) {
    health.checks.redis = 'error';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

---

## Security Best Practices

### Token Security

- Never commit tokens to version control
- Use environment secrets in CI/CD
- Rotate tokens periodically
- Use project tokens (not account) for CI/CD

### Variable Security

- Use sealed variables for sensitive data
- Avoid logging environment variables
- Use reference variables to reduce duplication

### Network Security

- Use private networking for internal communication
- Don't expose databases publicly unless necessary
- Enable SSL/TLS for all public endpoints (automatic)

### Access Control

- Use team workspaces for shared projects
- Limit who can deploy to production
- Review audit logs for suspicious activity

### Dependency Security

```bash
# Audit dependencies before deploy
npm audit
pip check
bundle audit

# Use lockfiles
npm ci  # not npm install
pip install -r requirements.txt
bundle install --frozen
```

---

## Troubleshooting Deep Dive

### Build Failures

```bash
# View build logs
railway logs -b

# Common issues:
# 1. Missing dependencies
# 2. Incorrect Node/Python version
# 3. Build command errors
# 4. Out of memory during build
```

**Nixpacks detection issues**:
```bash
# Specify build command explicitly
railway variables --set NIXPACKS_BUILD_CMD="npm run build"

# Or use Dockerfile
```

**Memory issues during build**:
```json
{
  "build": {
    "builder": "nixpacks"
  }
}
```

### Deployment Failures

```bash
# Check deployment status
railway status

# View runtime logs
railway logs

# Common issues:
# 1. Application crash on startup
# 2. Port binding issues
# 3. Missing environment variables
# 4. Health check failures
```

**Port issues**:
```javascript
// Always use PORT env var
const port = process.env.PORT || 3000;
app.listen(port, '::');
```

**Health check failures**:
```bash
# Increase timeout in railway.json
{
  "deploy": {
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300  # 5 minutes
  }
}
```

### Network Issues

```bash
# Test internal connectivity
railway ssh -- curl http://api.railway.internal:3000/health

# Check DNS resolution
railway ssh -- nslookup api.railway.internal

# Test external connectivity
railway ssh -- curl https://api.example.com
```

### Database Connection Issues

```bash
# Test database connection
railway connect

# Check connection string
railway variables | grep DATABASE_URL

# Test from application context
railway run node -e "console.log(process.env.DATABASE_URL)"
```

### Memory/CPU Issues

```bash
# Check resource usage
railway ssh -- free -m
railway ssh -- ps aux --sort=-%mem | head

# Monitor in real-time
railway ssh -- top -b -n 1
```

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `ECONNREFUSED` | Service not running | Check logs, verify port |
| `ENOTFOUND` | DNS resolution failed | Check service name spelling |
| `ETIMEDOUT` | Network timeout | Check firewall, service health |
| `ENOMEM` | Out of memory | Increase memory, optimize app |
| `EACCES` | Permission denied | Check file permissions |

---

## Config as Code

### railway.json Schema

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks",
    "buildCommand": "npm run build",
    "watchPatterns": ["src/**"]
  },
  "deploy": {
    "startCommand": "npm start",
    "releaseCommand": "npm run migrate",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "region": "us-west2"
  }
}
```

### Build Options

```json
{
  "build": {
    "builder": "nixpacks",           // or "dockerfile"
    "buildCommand": "npm run build",
    "dockerfilePath": "Dockerfile",  // if using dockerfile builder
    "watchPatterns": ["src/**", "package.json"]
  }
}
```

### Deploy Options

```json
{
  "deploy": {
    "startCommand": "node server.js",
    "releaseCommand": "npx prisma migrate deploy",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",  // or "ALWAYS", "NEVER"
    "restartPolicyMaxRetries": 10,
    "region": "us-west2",
    "numReplicas": 2
  }
}
```

### Region Configuration

```json
{
  "deploy": {
    "region": "us-west2"
  }
}
```

Available regions:
- `us-west2` - California, USA
- `us-east4-eqdc4a` - Virginia, USA
- `europe-west4-drams3a` - Amsterdam, Netherlands
- `asia-southeast1-eqsg3a` - Singapore

---

## Cost Optimization

### Resource Right-Sizing

```bash
# Monitor actual usage
railway ssh -- free -m
railway ssh -- ps aux --sort=-%mem | head

# Start small, scale up as needed
```

### Auto-Sleep (Hobby Plan)

Services on Hobby plan auto-sleep after inactivity:
- First request may have cold start delay
- Use health checks to keep alive if needed

### Efficient Deployments

```bash
# Use .railwayignore to exclude large files
node_modules/
.git/
*.log
coverage/
```

### Database Optimization

- Use connection pooling
- Index frequently queried columns
- Monitor query performance

### Build Optimization

```dockerfile
# Multi-stage builds for smaller images
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/server.js"]
```

---

## Quick Troubleshooting Reference

```bash
# General debugging workflow
railway status          # 1. Check project status
railway logs            # 2. View runtime logs
railway logs -b         # 3. View build logs
railway ssh             # 4. SSH for deeper inspection

# Network debugging
railway ssh -- curl http://service.railway.internal:3000
railway ssh -- nslookup service.railway.internal

# Resource debugging
railway ssh -- free -m
railway ssh -- df -h
railway ssh -- ps aux

# Variable debugging
railway variables -k
railway run printenv | sort

# Authentication debugging
railway whoami
railway status
```

---

**Last Updated**: 2025-12-27 | **Version**: 1.0.0
