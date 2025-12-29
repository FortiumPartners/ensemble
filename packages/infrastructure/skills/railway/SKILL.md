---
name: railway
description: Railway platform CLI for service deployment, infrastructure management, and debugging. Use for creating services, managing deployments, configuring networking, and reviewing logs.
version: 1.0.0
allowed-tools: Bash, Read, Glob, Grep
---

# Railway CLI Skill

**Version**: 1.0.0 | **Target**: <25KB | **Purpose**: Fast reference for Railway CLI operations

---

## Overview

**What is Railway**: Modern platform-as-a-service (PaaS) for instant deployments with zero configuration. Supports any language/framework via Nixpacks or Dockerfile. Includes managed databases, private networking, and automatic SSL.

**When to Use This Skill**:
- Deploying applications to Railway
- Managing Railway services and databases
- Debugging deployments (logs, SSH, status)
- Configuring networking and domains
- Managing environment variables
- CI/CD integration

**Auto-Detection Triggers**:
- `railway.json` or `railway.toml` in project root
- `RAILWAY_TOKEN` in `.env` file
- `RAILWAY_API_TOKEN` environment variable
- User mentions "Railway", "railway up", "railway logs"

**Progressive Disclosure**:
- **This file (SKILL.md)**: Quick reference for immediate use
- **REFERENCE.md**: Comprehensive guide with advanced patterns

---

## Critical: Avoiding Interactive Mode

**Railway CLI can enter interactive mode which will hang Claude Code.** Always use flags to bypass prompts:

| Command | WRONG (Interactive) | CORRECT (Non-Interactive) |
|---------|---------------------|---------------------------|
| Link project | `railway link` | `railway link -p <project> -e <env>` |
| Create project | `railway init` | `railway init -n <name>` |
| Switch env | `railway environment` | `railway environment <name>` |
| Select service | `railway service` | `railway service <name>` |
| Remove deploy | `railway down` | `railway down -y` |
| Redeploy | `railway redeploy` | `railway redeploy -y` |
| Delete env | `railway environment delete` | `railway environment delete -y` |
| Deploy | `railway up` | `railway up --detach` |
| SSH | `railway ssh` | `railway ssh -- <command>` |

**Required flags for automation**:
- `-y` / `--yes` - Skip confirmation prompts
- `--detach` / `-d` - Don't wait for deployment completion
- Explicit names/IDs - Avoid selection menus
- `--json` - Machine-readable output
- `-- <command>` - For SSH, run command directly instead of opening shell

**Never use in Claude Code**:
- `railway login` (use RAILWAY_TOKEN instead)
- `railway connect` without specifying service (opens interactive shell)
- `railway shell` (opens interactive shell)
- Any command without explicit parameters

---

## Table of Contents

1. [Prerequisites & Installation](#prerequisites--installation)
2. [Authentication](#authentication)
3. [CLI Decision Tree](#cli-decision-tree)
4. [Command Reference](#command-reference)
5. [Static Reference Data](#static-reference-data)
6. [Common Workflows](#common-workflows)
7. [Private Networking](#private-networking)
8. [Error Handling](#error-handling)
9. [Framework Examples](#framework-examples)
10. [Agent Integration](#agent-integration)

---

## Prerequisites & Installation

### Verify Installation

```bash
# Check CLI installed
railway --version  # Expects: 3.x.x or higher
```

### Installation Methods

```bash
# npm (Node.js 16+ required)
npm i -g @railway/cli

# Homebrew (macOS/Linux)
brew install railway

# Shell script (macOS/Linux/WSL)
bash <(curl -fsSL cli.new)

# Scoop (Windows)
scoop install railway

# Cargo (Rust)
cargo install railwayapp --locked
```

---

## Authentication

### Token Types

| Token Type | Env Variable | Scope | Use Cases |
|------------|--------------|-------|-----------|
| Project Token | `RAILWAY_TOKEN` | Single project | `up`, `redeploy`, `logs`, CI/CD |
| Account Token | `RAILWAY_API_TOKEN` | All account projects | `init`, `list`, `whoami`, full access |
| Team Token | `RAILWAY_API_TOKEN` | Workspace-scoped | Team-level operations |

### Authentication Priority (Check in Order)

**IMPORTANT**: Always check for project-specific credentials first.

1. **Project `.env`** (PREFERRED - project-specific):
   ```bash
   # Check project .env for RAILWAY_TOKEN
   grep RAILWAY_TOKEN .env

   # Run commands with project token
   export RAILWAY_TOKEN="$(grep RAILWAY_TOKEN .env | cut -d= -f2)"
   railway status
   ```

2. **Environment Variable** (session override):
   ```bash
   export RAILWAY_TOKEN="your-project-token"
   # or
   export RAILWAY_API_TOKEN="your-account-token"
   ```

3. **Interactive Login** (development):
   ```bash
   railway login              # Opens browser
   railway login --browserless  # Pairing code for headless
   ```

### Running Commands with Project Credentials

```bash
# Inline token from project .env (recommended)
RAILWAY_TOKEN=$(grep RAILWAY_TOKEN .env | cut -d= -f2) railway <command>

# Or export for session
export RAILWAY_TOKEN=$(grep RAILWAY_TOKEN .env | cut -d= -f2)
railway <command>
```

---

## CLI Decision Tree

### Project Operations

```
User wants to...
├── Create new project
│   └── railway init [-n name] [-w workspace]
├── Link to existing project
│   └── railway link [-p project] [-e environment] [-s service]
├── List all projects
│   └── railway list
├── Unlink current directory
│   └── railway unlink [-s service]
├── View project status
│   └── railway status
├── Open project dashboard
│   └── railway open
└── View current user
    └── railway whoami
```

### Deployment Operations

```
User wants to...
├── Deploy current directory
│   └── railway up [-d detach] [-s service] [-e environment]
├── Redeploy latest
│   └── railway redeploy [-s service] [-y yes]
├── Remove latest deployment
│   └── railway down [-y yes]
└── Deploy template
    └── railway deploy -t <template> [-v variable=value]
```

### Service Operations

```
User wants to...
├── Add new service
│   ├── Database: railway add -d postgres|mysql|redis|mongo
│   ├── From repo: railway add -r owner/repo
│   ├── From image: railway add -i image:tag
│   └── Empty service: railway add -s name
├── Link to service
│   └── railway service [service-name]
└── Manage variables
    └── railway variables [-s service] [--set KEY=value]
```

### Database Operations

```
User wants to...
├── Connect to database shell
│   ├── Postgres: railway connect [service] → psql
│   ├── MySQL: railway connect [service] → mysql
│   ├── Redis: railway connect [service] → redis-cli
│   └── MongoDB: railway connect [service] → mongosh
└── Run with database vars
    └── railway run <command>
```

### Debugging Operations

```
User wants to...
├── View logs
│   └── railway logs [-d deployment] [-b build]
├── SSH into service
│   └── railway ssh [-s service] [-e environment] [command]
├── Check status
│   └── railway status
├── Open dashboard
│   └── railway open
└── Open docs
    └── railway docs
```

### Environment Operations

```
User wants to...
├── Switch environment
│   └── railway environment [env-name]
├── Create new environment
│   └── railway environment new [-d duplicate]
└── Delete environment
    └── railway environment delete [-y yes]
```

### Volume Operations

```
User wants to...
├── List volumes
│   └── railway volume list
├── Add volume
│   └── railway volume add [-s service]
├── Delete volume
│   └── railway volume delete
├── Attach volume
│   └── railway volume attach [-s service]
└── Detach volume
    └── railway volume detach [-s service]
```

### Networking Operations

```
User wants to...
├── Generate Railway domain
│   └── railway domain [-p port] [-s service]
├── Add custom domain
│   └── railway domain <custom.domain.com> [-p port]
└── Manage variables
    └── railway variables --set KEY=value
```

---

## Command Reference

### Project Management

| Command | Description | Example |
|---------|-------------|---------|
| `railway init` | Create new project | `railway init -n myapp` |
| `railway link` | Link directory to project | `railway link -p myproject -e production` |
| `railway list` | List all projects | `railway list` |
| `railway unlink` | Remove project link | `railway unlink` |
| `railway status` | Show current status | `railway status` |
| `railway open` | Open dashboard | `railway open` |
| `railway whoami` | Show current user | `railway whoami` |

### Deployment Commands

| Command | Description | Example |
|---------|-------------|---------|
| `railway up` | Deploy directory | `railway up --detach` |
| `railway redeploy` | Redeploy latest | `railway redeploy -y` |
| `railway down` | Remove deployment | `railway down -y` |
| `railway deploy` | Deploy template | `railway deploy -t postgres` |
| `railway logs` | View deploy logs | `railway logs -d <id>` |

### Service Operations

| Command | Description | Example |
|---------|-------------|---------|
| `railway add` | Add service | `railway add -d postgres` |
| `railway service` | Link to service | `railway service api` |
| `railway connect` | Database shell | `railway connect postgres` |
| `railway run` | Run with vars | `railway run npm start` |
| `railway shell` | Open shell with vars | `railway shell` |

### Environment & Variables

| Command | Description | Example |
|---------|-------------|---------|
| `railway environment` | Switch environment | `railway environment staging` |
| `railway environment new` | Create environment | `railway environment new -d production` |
| `railway variables` | Show variables | `railway variables` |
| `railway variables --set` | Set variable | `railway variables --set API_KEY=xxx` |

### Debugging Commands

| Command | Description | Example |
|---------|-------------|---------|
| `railway logs` | View logs | `railway logs` |
| `railway logs -b` | View build logs | `railway logs -b` |
| `railway ssh` | SSH into service | `railway ssh -s api` |
| `railway ssh -- cmd` | Run SSH command | `railway ssh -- ls -la` |
| `railway status` | Show status | `railway status` |

### Volume Management

| Command | Description | Example |
|---------|-------------|---------|
| `railway volume list` | List volumes | `railway volume list` |
| `railway volume add` | Add volume | `railway volume add -s api` |
| `railway volume delete` | Delete volume | `railway volume delete` |
| `railway volume attach` | Attach to service | `railway volume attach -s api` |
| `railway volume detach` | Detach from service | `railway volume detach -s api` |

---

## Static Reference Data

### Deployment Regions (Metal)

| Code | Location | Notes |
|------|----------|-------|
| `us-west2` | California, USA | US West Metal |
| `us-east4-eqdc4a` | Virginia, USA | US East Metal |
| `europe-west4-drams3a` | Amsterdam, Netherlands | EU West Metal |
| `asia-southeast1-eqsg3a` | Singapore | Southeast Asia Metal |

**Note**: Metal regions available to all users. Region can be changed anytime without affecting domains or private networking (except for services with volumes).

### Database Types

| Type | CLI Flag | Shell Command |
|------|----------|---------------|
| PostgreSQL | `-d postgres` | `psql` |
| MySQL | `-d mysql` | `mysql` |
| Redis | `-d redis` | `redis-cli` |
| MongoDB | `-d mongo` | `mongosh` |

### Railway-Provided Variables

| Variable | Description |
|----------|-------------|
| `RAILWAY_PUBLIC_DOMAIN` | Public domain for service |
| `RAILWAY_PRIVATE_DOMAIN` | Private domain (.railway.internal) |
| `RAILWAY_TCP_PROXY_PORT` | TCP proxy port |
| `RAILWAY_ENVIRONMENT` | Current environment name |
| `RAILWAY_PROJECT_ID` | Project ID |
| `RAILWAY_SERVICE_ID` | Service ID |
| `PORT` | Port to listen on (set by Railway) |

### Reference Variable Syntax

```bash
# Reference shared variable
${{ shared.DATABASE_URL }}

# Reference another service's variable
${{ api.PORT }}
${{ api.RAILWAY_PRIVATE_DOMAIN }}

# Reference same service variable
${{ VARIABLE_NAME }}

# Example: Full service URL
API_URL=http://${{ api.RAILWAY_PRIVATE_DOMAIN }}:${{ api.PORT }}
```

---

## Common Workflows

**All commands use non-interactive flags for Claude Code compatibility.**

### 1. Initialize New Project

```bash
# Create new project (ALWAYS specify name)
railway init -n myapp

# Link to existing project (ALWAYS specify project and environment)
railway link -p myproject -e production
```

### 2. Deploy Application

```bash
# Deploy detached (ALWAYS use --detach to avoid blocking)
railway up --detach

# Deploy specific service
railway up --detach -s api

# Redeploy (ALWAYS use -y to skip confirmation)
railway redeploy -y
railway redeploy -y -s api
```

### 3. Add Database

```bash
# Add PostgreSQL (non-interactive)
railway add -d postgres

# Add Redis with name
railway add -d redis -s cache

# Run local command with DB vars (non-interactive)
railway run npm run migrate

# AVOID: railway connect (opens interactive shell)
# INSTEAD: Use railway run for one-off commands
railway run psql -c "SELECT version();"
```

### 4. Configure Domain

```bash
# Generate Railway domain
railway domain

# Add custom domain with port
railway domain api.myapp.com -p 3000

# For specific service
railway domain -s api -p 8080
```

### 5. Debug Failing Deployment

```bash
# Check deployment status
railway status

# View recent logs
railway logs

# View build logs
railway logs -b

# SSH: ALWAYS use -- with command (never open interactive shell)
railway ssh -- ps aux
railway ssh -- cat /app/logs/error.log
railway ssh -- ls -la /app
railway ssh -- printenv | sort

# Multiple commands in one SSH call
railway ssh -- "ps aux && df -h && free -m"
```

### 6. Manage Environments

```bash
# Switch to staging (explicit name, not interactive)
railway environment staging

# Create new environment (specify source)
railway environment new -d production

# Delete environment (ALWAYS use -y)
railway environment delete staging -y

# Set variable
railway variables --set DEBUG=true
```

### 7. CI/CD Deployment

```bash
# In CI (uses RAILWAY_TOKEN env var)
export RAILWAY_TOKEN=${{ secrets.RAILWAY_TOKEN }}
railway up --detach -s api
```

### 8. Remove Deployment

```bash
# ALWAYS use -y to skip confirmation
railway down -y
```

---

## Private Networking

### Internal DNS Format

Services communicate via private DNS:
```
<service-name>.railway.internal
```

**Example**: Service named `api` listening on port 3000:
```
http://api.railway.internal:3000
```

### Configuration Requirements

Applications should listen on `::` (all interfaces) for IPv4/IPv6 compatibility:

**Node.js**:
```javascript
app.listen(process.env.PORT, '::', () => {
  console.log('Server running');
});
```

**Python/Gunicorn**:
```bash
gunicorn --bind "[::]:${PORT:-3000}" app:app
```

**Go**:
```go
http.ListenAndServe("[::]:"+os.Getenv("PORT"), nil)
```

### Service-to-Service Communication

```bash
# Set reference variable for backend URL
railway variables --set BACKEND_URL=http://\${{api.RAILWAY_PRIVATE_DOMAIN}}:\${{api.PORT}}
```

### Library-Specific Configurations

**ioredis**:
```javascript
// Add family=0 for dual-stack
const redis = new Redis(process.env.REDIS_URL + '?family=0');
```

**BullMQ**:
```javascript
const connection = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  family: 0  // Required for private networking
};
```

---

## Error Handling

### Common Errors and Resolutions

| Error | Cause | Resolution |
|-------|-------|------------|
| `command not found: railway` | CLI not installed | Install via npm/brew/script |
| `Not logged in` | No authentication | `railway login` or set RAILWAY_TOKEN |
| `No project linked` | Directory not linked | `railway link` or `railway init` |
| `Unauthorized` | Invalid/expired token | Check token, re-authenticate |
| `Service not found` | Invalid service name | `railway status` to list services |
| `Deployment failed` | Build/runtime error | `railway logs -b` for build logs |
| `Rate limited` | Too many requests | Wait, implement backoff |

### Authentication Troubleshooting

```bash
# Verify authentication
railway whoami

# Check which project is linked
railway status

# Re-authenticate
railway logout
railway login

# Or use token directly
export RAILWAY_TOKEN="your-token"
```

### Deployment Troubleshooting

```bash
# View build logs for errors
railway logs -b

# View runtime logs
railway logs

# Check service status
railway status

# SSH for deeper debugging
railway ssh
railway ssh -- cat /app/package.json
railway ssh -- node --version
```

### Graceful Fallback

If CLI unavailable, provide web URLs:
- Dashboard: `https://railway.app/dashboard`
- Project: `https://railway.app/project/<project-id>`
- Docs: `https://docs.railway.com`

---

## Framework Examples

### Node.js (Express/Fastify)

**Dockerfile** (optional - Nixpacks auto-detects):
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

**Application code**:
```javascript
const port = process.env.PORT || 3000;
app.listen(port, '::', () => {
  console.log(`Server on port ${port}`);
});
```

### Python (Django/FastAPI/Flask)

**Procfile**:
```
web: gunicorn --bind "[::]:${PORT:-8000}" app:app
```

**Or with uvicorn (FastAPI)**:
```
web: uvicorn main:app --host :: --port ${PORT:-8000}
```

### Rails

**Procfile**:
```
web: bundle exec rails server -b :: -p ${PORT:-3000}
release: bundle exec rails db:migrate
```

**railway.json** (Config as Code):
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks"
  },
  "deploy": {
    "startCommand": "bundle exec rails server -b :: -p $PORT",
    "releaseCommand": "bundle exec rails db:migrate"
  }
}
```

### Go

```go
package main

import (
    "net/http"
    "os"
)

func main() {
    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
    }
    http.ListenAndServe("[::]:"+port, nil)
}
```

---

## Agent Integration

### Auto-Detection (No Slash Command)

This skill auto-loads when Railway context is detected:

**File-based triggers**:
- `railway.json` or `railway.toml` in project root
- `RAILWAY_TOKEN` in `.env` file
- `RAILWAY_API_TOKEN` environment variable

**Context-based triggers**:
- User mentions "Railway", "deploy to Railway"
- User runs railway commands
- Debugging Railway-hosted services
- Database connection issues with Railway

### Pattern Recognition

```yaml
High-confidence triggers:
  - "Deploy to Railway"
  - "Check Railway logs"
  - "railway up"
  - "railway logs"
  - "Add database to Railway"
  - "Railway deployment failing"
  - "SSH into Railway service"
  - "Configure Railway domain"

Medium-confidence triggers:
  - "Check deployment status"
  - "View service logs"
  - "Add PostgreSQL"
  - "Debug production issue" (if Railway detected)
```

### Handoff to Deep-Debugger

For complex debugging issues:
```yaml
When to handoff:
  - Build failures with unclear errors
  - Runtime crashes requiring code analysis
  - Performance issues requiring profiling
  - Memory leaks or resource exhaustion

Provide context:
  - railway logs output
  - railway status output
  - Relevant error messages
  - Service configuration
```

### JSON Output Mode

All commands support `--json` for programmatic parsing:

```bash
railway status --json | jq '.services[].name'
railway logs --json | jq -r '.message'
```

---

## Quick Reference Card (Non-Interactive)

```bash
# Authentication (NEVER use railway login in Claude Code)
export RAILWAY_TOKEN="xxx"                    # Token auth (required)
export RAILWAY_TOKEN="$(grep RAILWAY_TOKEN .env | cut -d= -f2)"

# Project (ALWAYS specify names)
railway init -n myapp                         # Create project
railway link -p myproject -e production       # Link to project
railway status                                # Show status
railway unlink                                # Unlink project

# Deploy (ALWAYS use --detach)
railway up --detach                           # Deploy (background)
railway up --detach -s api                    # Deploy specific service
railway redeploy -y                           # Redeploy (skip prompt)
railway down -y                               # Remove (skip prompt)

# Services & Databases
railway add -d postgres                       # Add PostgreSQL
railway add -d redis -s cache                 # Add named Redis
railway run npm run migrate                   # Run with vars
# AVOID: railway connect / railway shell (interactive)

# Debugging (use -- for SSH commands)
railway logs                                  # View logs
railway logs -b                               # Build logs
railway ssh -- ps aux                         # Run command via SSH
railway ssh -- cat /app/logs/app.log          # View remote file
railway ssh -- "df -h && free -m"             # Multiple commands

# Environment (explicit names)
railway environment staging                   # Switch env
railway environment new -d production         # Create from prod
railway environment delete staging -y         # Delete (skip prompt)
railway variables --set KEY=value             # Set variable

# Networking
railway domain                                # Generate domain
railway domain api.example.com -p 3000        # Custom domain
```

---

**Progressive Disclosure**: Start here for quick reference. Load REFERENCE.md for comprehensive patterns, advanced configurations, and troubleshooting deep-dives.

**Last Updated**: 2025-12-27 | **Version**: 1.0.0
