# Fly.io Infrastructure Skills

**Version**: 1.0.0 | **Target Size**: <25KB | **Purpose**: Fast reference for Fly.io deployments and global application distribution

---

## Overview

**What is Fly.io**: Modern platform-as-a-service (PaaS) for deploying applications globally with minimal configuration. Fly.io transforms containers into micro-VMs that run on physical hardware across 30+ regions worldwide.

**When to Use Fly.io**:
- Simple to moderate applications requiring global distribution
- Fast deployments without complex Kubernetes orchestration
- Minimal operations overhead with PaaS simplicity
- Edge computing and low-latency requirements (anycast routing)
- Startup/SaaS applications with unpredictable traffic patterns
- Databases requiring multi-region active replication (Fly Postgres)

**When to Use Kubernetes Instead**:
- Complex microservices architectures with 10+ interdependent services
- Existing Kubernetes expertise and tooling investment
- Hybrid cloud or multi-cloud requirements (cloud-agnostic)
- Advanced orchestration needs (service mesh, custom operators, advanced scheduling)
- Enterprise compliance requirements (HIPAA, PCI-DSS on-premises)
- Extensive third-party ecosystem integrations (Helm charts, operators)

**Detection Criteria**:
- Auto-loads when `fly.toml` detected in project root
- Manual: `--tools=flyio` flag
- Use Case: Global application deployment with PaaS simplicity

**Progressive Disclosure**:
- **This file (SKILL.md)**: Quick reference for immediate use
- **REFERENCE.md**: Comprehensive guide with advanced patterns and deployment strategies

---

## Table of Contents

1. [fly.toml Quick Reference](#flytoml-quick-reference)
2. [Deployment Patterns](#deployment-patterns)
3. [Secrets Management](#secrets-management)
4. [Networking Basics](#networking-basics)
5. [Health Checks](#health-checks)
6. [Scaling Patterns](#scaling-patterns)
7. [Common Commands Cheat Sheet](#common-commands-cheat-sheet)
8. [Quick Troubleshooting](#quick-troubleshooting)
9. [Framework-Specific Examples](#framework-specific-examples)

---

## fly.toml Quick Reference

### Minimal Configuration (Node.js Express)

```toml
# app name (must be globally unique on Fly.io)
app = "my-express-app"

[build]
  # Dockerfile-based build (default)
  dockerfile = "Dockerfile"

[env]
  # Non-sensitive environment variables
  NODE_ENV = "production"
  PORT = "8080"

[[services]]
  internal_port = 8080  # Container port
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80  # External HTTP

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443  # External HTTPS

  # Health check
  [[services.http_checks]]
    interval = "10s"
    timeout = "2s"
    grace_period = "5s"
    method = "GET"
    path = "/health"
```

**Key Concepts**:
- **app**: Globally unique application name (DNS-safe)
- **build**: How to build your application (Dockerfile, buildpacks)
- **env**: Non-sensitive configuration (use secrets for sensitive data)
- **services**: Network services exposed to the internet
- **internal_port**: Port your app listens on inside container
- **ports**: External ports (80 HTTP, 443 HTTPS)
- **http_checks**: Health check configuration

---

### Node.js (Express, Fastify, Koa)

```toml
app = "nodejs-api"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "8080"

[[services]]
  internal_port = 8080
  protocol = "tcp"
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.http_checks]]
    interval = "10s"
    timeout = "2s"
    grace_period = "5s"
    method = "GET"
    path = "/health"
    protocol = "http"
```

**Dockerfile** (minimal):
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
```

---

### Next.js Application

```toml
app = "nextjs-app"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"

[[services]]
  internal_port = 3000
  protocol = "tcp"
  auto_stop_machines = true
  auto_start_machines = true

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.http_checks]]
    interval = "15s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/"
```

**Dockerfile** (Next.js standalone):
```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

---

### Python (Django, FastAPI, Flask)

```toml
app = "python-api"

[build]
  dockerfile = "Dockerfile"

[env]
  PYTHONUNBUFFERED = "1"
  PORT = "8000"

[[services]]
  internal_port = 8000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.http_checks]]
    interval = "10s"
    timeout = "2s"
    grace_period = "5s"
    method = "GET"
    path = "/health"
```

**Dockerfile** (FastAPI example):
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

### Go Microservice

```toml
app = "go-service"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"

[[services]]
  internal_port = 8080
  protocol = "tcp"
  auto_stop_machines = true
  auto_start_machines = true

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.tcp_checks]]
    interval = "10s"
    timeout = "2s"
    grace_period = "5s"
```

**Dockerfile** (multi-stage Go build):
```dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/server

FROM alpine:latest
RUN apk --no-cache add ca-certificates
COPY --from=builder /app/server /app/server
EXPOSE 8080
CMD ["/app/server"]
```

---

### Ruby on Rails

```toml
app = "rails-app"

[build]
  dockerfile = "Dockerfile"

[env]
  RAILS_ENV = "production"
  PORT = "3000"

[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.http_checks]]
    interval = "10s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/health"
```

---

### Elixir Phoenix

```toml
app = "phoenix-app"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "4000"
  MIX_ENV = "prod"

[deploy]
  release_command = "/app/bin/migrate"

[[services]]
  internal_port = 4000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.http_checks]]
    interval = "10s"
    timeout = "2s"
    grace_period = "5s"
    method = "GET"
    path = "/health"
```

**Key Feature**: `release_command` runs database migrations before deployment.

---

## Deployment Patterns

### Zero-Downtime Deployments

Fly.io's **rolling deployment** ensures zero downtime:

```toml
[deploy]
  strategy = "rolling"  # Default
  max_unavailable = 0.33  # 33% of machines can be down during deploy
```

**How it works**:
1. New machines start with updated code
2. Health checks pass on new machines
3. Old machines drain connections (graceful shutdown)
4. Old machines stop after connections close

**Graceful Shutdown**:
```javascript
// Express.js example
const server = app.listen(PORT);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
```

**Health Check Requirements**:
```toml
[[services.http_checks]]
  interval = "10s"
  timeout = "2s"
  grace_period = "5s"  # Wait 5s before first check
  method = "GET"
  path = "/health"
```

---

### Blue-Green Deployment

```bash
# Deploy to new machines without affecting current ones
fly deploy --strategy=immediate --no-cache

# Traffic still routes to old machines
# Validate new deployment
fly status

# Switch traffic to new machines (instant cutover)
fly deploy --strategy=bluegreen
```

**When to use**:
- Critical production deployments requiring validation
- Database migrations requiring downtime window
- High-risk changes requiring instant rollback capability

---

### Canary Releases

Gradual traffic shifting:

```bash
# Deploy new version to 10% of machines
fly deploy --strategy=canary:10

# Monitor metrics, errors, logs
fly logs

# Increase to 50%
fly deploy --strategy=canary:50

# Full rollout
fly deploy --strategy=rolling
```

**When to use**:
- New features with uncertain performance impact
- Gradual rollout to detect issues early
- A/B testing scenarios

---

### Rollback Procedures

```bash
# View release history
fly releases

# Example output:
# VERSION  STATUS   DESCRIPTION
# v3       current  Deploy by user@example.com
# v2       complete Deploy by user@example.com
# v1       complete Deploy by user@example.com

# Rollback to previous version (v2)
fly deploy --image registry.fly.io/my-app:v2

# Immediate rollback (no health checks)
fly deploy --strategy=immediate --image registry.fly.io/my-app:v2
```

**Emergency Rollback**:
```bash
# Rollback and bypass all health checks
fly deploy --strategy=immediate --no-cache --image registry.fly.io/my-app:v2
```

---

## Secrets Management

### Setting Secrets

```bash
# Set single secret
fly secrets set DATABASE_URL="postgres://user:pass@host/db"

# Set multiple secrets
fly secrets set \
  API_KEY="abc123" \
  JWT_SECRET="xyz789" \
  STRIPE_KEY="sk_live_..."

# Set secret from file
fly secrets set SSL_CERT="$(cat cert.pem)"

# Import from .env file
fly secrets import < .env
```

**Important**: Secrets are encrypted at rest and never logged.

---

### Multi-Environment Segregation

**Development**:
```bash
fly secrets set -a my-app-dev \
  DATABASE_URL="postgres://dev-host/myapp_dev" \
  STRIPE_KEY="sk_test_..."
```

**Staging**:
```bash
fly secrets set -a my-app-staging \
  DATABASE_URL="postgres://staging-host/myapp_staging" \
  STRIPE_KEY="sk_test_..."
```

**Production**:
```bash
fly secrets set -a my-app-prod \
  DATABASE_URL="postgres://prod-host/myapp_prod" \
  STRIPE_KEY="sk_live_..."
```

**Best Practice**: Use separate apps for each environment (`-dev`, `-staging`, `-prod`).

---

### Viewing and Removing Secrets

```bash
# List secret names (values hidden)
fly secrets list

# Unset secret
fly secrets unset API_KEY

# Unset multiple secrets
fly secrets unset API_KEY JWT_SECRET
```

**Security Note**: Secret values cannot be retrieved after setting. Store backups securely.

---

### Secrets Rotation Strategy

```bash
# 1. Set new secret with different name
fly secrets set NEW_DATABASE_URL="postgres://new-host/db"

# 2. Update application code to use NEW_DATABASE_URL
fly deploy

# 3. Verify application works with new secret
fly logs

# 4. Remove old secret
fly secrets unset DATABASE_URL

# 5. Rename secret (optional)
fly secrets set DATABASE_URL="$(fly secrets list | grep NEW_DATABASE_URL)"
fly secrets unset NEW_DATABASE_URL
```

---

## Networking Basics

### Internal Service Communication

Fly.io provides **internal DNS** for private service communication:

```
<app-name>.internal
```

**Example** (microservices):
```toml
# api-service fly.toml
app = "api-service"

[[services]]
  internal_port = 8080
  protocol = "tcp"

# worker-service fly.toml
app = "worker-service"

[env]
  API_URL = "http://api-service.internal:8080"
```

**Key Benefits**:
- No external traffic (faster, more secure)
- Automatic service discovery
- Load balancing across all machines

---

### External Access Configuration

**HTTP/HTTPS**:
```toml
[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443
```

**TCP/UDP**:
```toml
[[services]]
  internal_port = 5432
  protocol = "tcp"

  [[services.ports]]
    port = 5432
```

**WebSocket**:
```toml
[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80
    # WebSocket support included automatically
```

---

### Private Networking

Secure communication between apps:

```bash
# Allocate private IP
fly ips private

# Example: Connect database to API
# Database app
fly ips private -a my-postgres

# API app connects via internal DNS
# my-postgres.internal:5432
```

**Use Cases**:
- Database connections (Postgres, Redis)
- Backend-to-backend communication
- Admin tools accessing production systems

---

### Fly Proxy and Anycast Routing

**How it works**:
1. User request hits nearest Fly edge location (anycast)
2. Fly Proxy routes to nearest healthy machine
3. Machine processes request
4. Response returns to user

**Benefits**:
- Ultra-low latency (edge routing)
- Automatic SSL/TLS termination
- Global load balancing
- DDoS protection

**Regions**:
```bash
# List available regions
fly platform regions

# Add region
fly regions add lhr  # London Heathrow

# Remove region
fly regions remove lhr

# Backup regions (fallback)
fly regions set iad ord sjc --backup lhr
```

---

## Health Checks

### HTTP Health Checks

```toml
[[services.http_checks]]
  interval = "10s"        # Check every 10 seconds
  timeout = "2s"          # Timeout after 2 seconds
  grace_period = "5s"     # Wait 5s before first check (app startup)
  method = "GET"
  path = "/health"
  protocol = "http"
  tls_skip_verify = false
  headers = {}
```

**Health Check Endpoint** (Express.js):
```javascript
app.get('/health', (req, res) => {
  // Check database connection
  db.ping()
    .then(() => res.status(200).json({ status: 'healthy' }))
    .catch(() => res.status(503).json({ status: 'unhealthy' }));
});
```

---

### TCP Health Checks

For non-HTTP services (databases, caches):

```toml
[[services.tcp_checks]]
  interval = "10s"
  timeout = "2s"
  grace_period = "5s"
```

**When to use**:
- Redis, Postgres, MongoDB
- gRPC services
- Custom TCP protocols

---

### Custom Script-Based Health Checks

Use HTTP endpoint that runs comprehensive checks:

```javascript
app.get('/health', async (req, res) => {
  const checks = {
    database: false,
    redis: false,
    external_api: false
  };

  try {
    // Database check
    await db.query('SELECT 1');
    checks.database = true;

    // Redis check
    await redis.ping();
    checks.redis = true;

    // External API check (optional)
    await axios.get('https://api.example.com/ping', { timeout: 1000 });
    checks.external_api = true;

    // All checks passed
    res.status(200).json({ status: 'healthy', checks });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', checks, error: error.message });
  }
});
```

---

### Zero-Downtime Deployment Health Checks

**Requirements**:
1. **grace_period**: Allow app startup time
2. **Fast response**: <2s timeout (avoid slow queries)
3. **Critical dependencies only**: Don't fail on non-critical services

```toml
[[services.http_checks]]
  interval = "10s"
  timeout = "2s"
  grace_period = "10s"  # Allow 10s for app startup
  method = "GET"
  path = "/health"
```

**Best Practice**:
```javascript
// Fast health check (critical dependencies only)
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');  # Database only
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'error' });
  }
});

// Comprehensive readiness check (separate endpoint)
app.get('/ready', async (req, res) => {
  // Check all dependencies
  // Caches, external APIs, etc.
});
```

---

## Scaling Patterns

### Horizontal Scaling

```bash
# Scale to 3 machines
fly scale count 3

# Scale per region
fly scale count 2 --region iad  # US East
fly scale count 2 --region lhr  # London

# View current scale
fly status
```

**When to scale**:
- Increased traffic (CPU >70%, memory >80%)
- Global distribution requirements
- High availability (multiple machines per region)

---

### Auto-Scaling Configuration

```toml
[[services]]
  internal_port = 8080
  protocol = "tcp"
  auto_stop_machines = true   # Stop idle machines
  auto_start_machines = true  # Start on traffic
  min_machines_running = 1    # Always keep 1 running

[http_service.concurrency]
  type = "requests"
  soft_limit = 200   # Start new machine at 200 concurrent requests
  hard_limit = 250   # Reject requests at 250 concurrent requests
```

**How it works**:
1. Traffic increases → new machines start automatically
2. Traffic decreases → machines stop after idle timeout
3. **Cost savings**: Pay only for running machines

**Best Practice**:
- Set `min_machines_running = 1` for production (avoid cold starts)
- Set `min_machines_running = 0` for dev/staging (cost optimization)

---

### Regional Distribution

```bash
# Add regions for global distribution
fly regions add iad ord sjc  # US East, Central, West
fly regions add lhr ams       # London, Amsterdam
fly regions add nrt syd       # Tokyo, Sydney

# View current regions
fly regions list

# Remove region
fly regions remove nrt
```

**Strategy**:
- Start with 1-2 regions near users
- Expand based on latency metrics
- Use backup regions for disaster recovery

---

### Resource Limits (CPU, Memory)

```bash
# View available machine types
fly platform vm-sizes

# Scale machine size
fly scale vm shared-cpu-1x  # 1 shared CPU, 256MB RAM
fly scale vm shared-cpu-2x  # 2 shared CPUs, 512MB RAM
fly scale vm dedicated-cpu-1x  # 1 dedicated CPU, 2GB RAM

# Custom memory
fly scale memory 512  # 512MB RAM
```

**Machine Types**:
- **shared-cpu-1x**: Small apps, low traffic (256MB)
- **shared-cpu-2x**: Medium apps (512MB)
- **dedicated-cpu-1x**: Production apps, consistent performance (2GB)
- **dedicated-cpu-2x**: High-traffic apps (4GB)

---

## Common Commands Cheat Sheet

### Deployment

```bash
fly deploy                    # Deploy application
fly deploy --strategy rolling # Rolling deployment (zero downtime)
fly deploy --strategy immediate  # Immediate deployment (downtime)
fly deploy --remote-only      # Build on Fly.io (not locally)
fly deploy --no-cache         # Rebuild without cache
```

### Scaling

```bash
fly scale count 3             # Scale to 3 machines
fly scale vm shared-cpu-2x    # Change machine type
fly scale memory 512          # Set memory to 512MB
fly regions add iad           # Add region
fly regions remove iad        # Remove region
fly autoscale standard min=1 max=10  # Enable autoscaling
```

### Secrets

```bash
fly secrets set KEY=value     # Set secret
fly secrets list              # List secret names
fly secrets unset KEY         # Remove secret
fly secrets import < .env     # Import from file
```

### Monitoring

```bash
fly logs                      # View logs
fly logs -a my-app            # Logs for specific app
fly logs --region iad         # Logs for specific region
fly status                    # Application status
fly vm status                 # Machine status
fly checks list               # Health check status
```

### Debugging

```bash
fly ssh console               # SSH into machine
fly ssh console -C "ps aux"   # Run command via SSH
fly ssh sftp shell            # SFTP access
fly proxy 5432                # Port forward to local machine
fly doctor                    # Diagnose issues
```

### App Management

```bash
fly apps list                 # List all apps
fly apps create my-app        # Create new app
fly apps destroy my-app       # Delete app
fly open                      # Open app in browser
fly info                      # Application info
```

---

## Quick Troubleshooting

### Top 10 Common Issues

1. **Deployment fails** → Check health checks: `fly logs`, adjust `grace_period`
2. **App not starting** → Review logs: `fly logs`, check Dockerfile CMD/ENTRYPOINT
3. **Network timeout** → Verify `internal_port` matches app port, check firewall rules
4. **Database connection fails** → Check secrets: `fly secrets list`, verify `DATABASE_URL`
5. **High memory usage** → Scale machine: `fly scale vm shared-cpu-2x`, optimize app
6. **SSL certificate issues** → Verify domain: `fly certs show`, add certificate: `fly certs add example.com`
7. **Regional latency** → Add regions: `fly regions add lhr ams`, monitor with `fly logs`
8. **Health check failures** → Adjust grace period: `grace_period = "10s"`, simplify health endpoint
9. **Build failures** → Review Dockerfile: `fly deploy --local-only`, check dependencies
10. **Cost concerns** → Right-size machines: `fly scale vm shared-cpu-1x`, enable auto-stop: `auto_stop_machines = true`

---

### Deployment Troubleshooting

**Failed health checks**:
```bash
# View health check status
fly checks list

# Increase grace period
# fly.toml
[[services.http_checks]]
  grace_period = "15s"  # Increase from 5s

# Check logs during deployment
fly logs --region iad
```

**Build failures**:
```bash
# Build locally to debug
fly deploy --local-only

# Clear cache and rebuild
fly deploy --no-cache

# View build logs
fly builds
```

---

### Runtime Troubleshooting

**High memory usage**:
```bash
# Check current usage
fly vm status

# Scale up memory
fly scale memory 1024

# Or upgrade machine type
fly scale vm dedicated-cpu-1x
```

**Connection issues**:
```bash
# Test internal networking
fly ssh console -C "curl http://other-app.internal:8080/health"

# Check external connectivity
fly ssh console -C "curl https://api.example.com"

# Port forward for local debugging
fly proxy 8080
```

**Logs not appearing**:
```bash
# Ensure app logs to stdout/stderr (not files)
# Check log level
fly logs --region iad

# SSH to machine and check logs
fly ssh console
tail -f /var/log/app.log
```

---

## Framework-Specific Examples

### NestJS Backend

```toml
app = "nestjs-api"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"

[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.http_checks]]
    interval = "10s"
    timeout = "2s"
    grace_period = "10s"
    method = "GET"
    path = "/health"
```

**NestJS Health Check**:
```typescript
// health.controller.ts
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: Date.now() };
  }
}
```

---

### Phoenix LiveView

```toml
app = "phoenix-liveview"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "4000"
  MIX_ENV = "prod"
  SECRET_KEY_BASE = "use-fly-secrets-set-for-this"

[deploy]
  release_command = "/app/bin/migrate"

[[services]]
  internal_port = 4000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443
```

**Phoenix Health Check**:
```elixir
# router.ex
get "/health", HealthController, :check

# health_controller.ex
defmodule MyApp.HealthController do
  use MyAppWeb, :controller

  def check(conn, _params) do
    json(conn, %{status: "ok"})
  end
end
```

---

### Rails Backend

```toml
app = "rails-api"

[build]
  dockerfile = "Dockerfile"

[env]
  RAILS_ENV = "production"
  PORT = "3000"

[deploy]
  release_command = "bin/rails db:migrate"

[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443
```

---

## Next Steps

**For Advanced Patterns**:
- See **REFERENCE.md** for comprehensive guide with deployment strategies, Fly Postgres, Redis, monitoring
- Covers: Multi-region databases, CI/CD integration, metrics, logging, cost optimization

**Common Use Cases**:
- Multi-region apps → REFERENCE.md § Global Distribution
- Database setup → REFERENCE.md § Fly Postgres
- CI/CD pipelines → REFERENCE.md § GitHub Actions Integration
- Production monitoring → REFERENCE.md § Observability

---

**Progressive Disclosure**: Start here for quick reference, load REFERENCE.md for comprehensive patterns and production examples.

**Performance Target**: <100ms skill loading (this file ~22KB)

**Last Updated**: 2025-10-25 | **Version**: 1.0.0
