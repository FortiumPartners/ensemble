# Fly.io Reference Guide

**Comprehensive guide with advanced patterns, production examples, and best practices.**

**Quick Reference**: See [SKILL.md](./SKILL.md) for essential patterns and commands.

---

## Fly.io Architecture Deep Dive

### Fly Machines

**Lightweight VMs**: Built on Firecracker micro VMs
- **Startup Time**: <1 second (cold start)
- **Billing**: Per-second billing (no idle costs when stopped)
- **Isolation**: Full VM isolation with shared kernel
- **Resource Control**: CPU, memory, disk allocation per machine

**Lifecycle States**:
- `created` - Machine provisioned but not started
- `starting` - Boot in progress
- `started` - Running and healthy
- `stopping` - Graceful shutdown in progress
- `stopped` - Halted (no billing)
- `destroyed` - Permanently removed

**Auto-start/stop**:
```toml
[http_service]
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0  # Scale to zero
  max_machines_running = 10  # Max capacity
```

### Global Network Architecture

**30+ Regions Worldwide**:
- **Primary Regions**: IAD (N. Virginia), LAX (Los Angeles), LHR (London), SYD (Sydney), NRT (Tokyo)
- **Edge Regions**: 25+ additional locations for low-latency access
- **Anycast Network**: Requests routed to nearest healthy region automatically

**Fly Proxy (Global Load Balancer)**:
- **TLS Termination**: Automatic HTTPS certificates via Let's Encrypt
- **HTTP/2 & HTTP/3**: Modern protocol support
- **WebSocket Support**: Long-lived connection handling
- **Request Routing**: Health-based, proximity-based, custom routing

**Internal Networking**:
- **6PN (IPv6 Private Network)**: Encrypted mesh network between machines
- **Flycast**: Private load balancing for internal services
- **WireGuard VPN**: Secure access to private network

### Storage Architecture

**Fly Volumes (Persistent NVMe SSD)**:
- **Performance**: High IOPS, low latency local storage
- **Durability**: Single region, no replication (use snapshots for backup)
- **Attachment**: One volume per machine (1:1 mapping)
- **Scaling**: Create multiple volumes across regions for HA

**S3-Compatible Object Storage (Tigris)**:
- **Global CDN**: Automatic edge caching
- **S3 API**: Drop-in replacement for AWS S3
- **Cost-Effective**: No egress fees between Fly apps

**External Databases**:
- Supabase (Postgres), PlanetScale (MySQL), Upstash (Redis)
- Connection security via Fly private network or public internet

---

## Advanced fly.toml Configuration

### Multi-Process Applications

Run multiple processes in the same machine:

```toml
[processes]
  web = "node server.js"
  worker = "node worker.js"
  scheduler = "node scheduler.js"

# Configure services per process
[[services]]
  processes = ["web"]  # Only web process handles HTTP
  internal_port = 8080

[[services]]
  processes = ["worker"]  # Worker internal service
  internal_port = 9090
  protocol = "tcp"
```

### Custom Machine Types and Resources

**Machine Size Selection**:
```toml
[vm]
  cpu_kind = "performance"  # Options: shared, performance
  cpus = 2
  memory_mb = 4096

# Dedicated CPUs (no sharing)
[vm]
  cpu_kind = "performance"
  cpus = 4
  memory_mb = 8192
```

**Machine Size Matrix**:
| Type | vCPUs | Memory | Use Case |
|------|-------|--------|----------|
| `shared-cpu-1x` | 1 shared | 256-2048 MB | Dev/small apps |
| `shared-cpu-2x` | 2 shared | 512-4096 MB | Small production |
| `performance-1x` | 1 dedicated | 2048 MB | CPU-bound |
| `performance-2x` | 2 dedicated | 4096 MB | High traffic |
| `performance-4x` | 4 dedicated | 8192 MB | Enterprise |

### Volume Configuration and Persistence

```toml
[mounts]
  source = "my_app_data"
  destination = "/data"
  initial_size = "10GB"

# Create volume with CLI
# fly volumes create my_app_data --region lax --size 10
```

**Volume Best Practices**:
- Create volumes in multiple regions for HA
- Use snapshots for backups (`fly volumes snapshots`)
- Monitor volume usage (`fly volumes list`)
- Consider object storage for static assets

### Advanced Networking

**Custom Ports and Protocols**:
```toml
[[services]]
  internal_port = 8080
  protocol = "tcp"
  auto_stop_machines = true
  auto_start_machines = true

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  # gRPC support
  [[services.ports]]
    port = 50051
    handlers = ["tls"]

  # WebSocket-specific configuration
  [[services.ports]]
    port = 8080
    handlers = ["http"]

    [services.ports.http_options]
      compress = false  # Disable compression for WebSocket
```

**Internal Service Communication**:
```toml
[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    port = 3000
    handlers = []  # Internal-only, no public exposure
```

### Environment-Specific Configuration

**Using `[env]` Sections with `--config` Flag**:

```toml
# fly.staging.toml
app = "myapp-staging"
primary_region = "lax"

[env]
  NODE_ENV = "staging"
  LOG_LEVEL = "debug"

[vm]
  memory_mb = 2048

# fly.production.toml
app = "myapp-production"
primary_region = "iad"

[env]
  NODE_ENV = "production"
  LOG_LEVEL = "info"

[vm]
  memory_mb = 4096
```

Deploy with: `fly deploy --config fly.staging.toml`

---

## Production Deployment Examples

### Example 1: Node.js Next.js Production

**fly.toml**:
```toml
app = "nextjs-app"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "3000"
  NODE_ENV = "production"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 2  # HA with 2 machines minimum
  max_machines_running = 10

  [http_service.concurrency]
    type = "requests"
    soft_limit = 200
    hard_limit = 250

[[vm]]
  cpu_kind = "shared"
  cpus = 2
  memory_mb = 2048
```

**Dockerfile** (Multi-stage with standalone build):
```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
```

**next.config.js** (Standalone output):
```javascript
module.exports = {
  output: 'standalone',
  compress: true,
  poweredByHeader: false,
  generateEtags: false,
}
```

**deploy.sh**:
```bash
#!/bin/bash
set -e

echo "Building and deploying to Fly.io..."

# Set secrets (do this once)
# fly secrets set DATABASE_URL="postgres://..." --app nextjs-app

# Deploy with zero-downtime
fly deploy --ha --strategy rolling

# Verify deployment
fly status

echo "Deployment complete!"
```

---

### Example 2: Python Django with PostgreSQL

**fly.toml**:
```toml
app = "django-app"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  DJANGO_SETTINGS_MODULE = "myproject.settings.production"
  PYTHONUNBUFFERED = "1"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = false  # Keep running for background tasks
  min_machines_running = 2

[[services]]
  internal_port = 8000
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [services.concurrency]
    type = "connections"
    soft_limit = 100
    hard_limit = 150

[mounts]
  source = "django_media"
  destination = "/app/media"
```

**Dockerfile**:
```dockerfile
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apt-get update && apt-get install -y \
  postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd -m -u 1000 django && chown -R django:django /app
USER django

RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "4", "--threads", "2", "myproject.wsgi:application"]
```

**settings/production.py**:
```python
import os
from .base import *

DEBUG = False
ALLOWED_HOSTS = ['.fly.dev', 'myapp.com']

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ['DATABASE_NAME'],
        'USER': os.environ['DATABASE_USER'],
        'PASSWORD': os.environ['DATABASE_PASSWORD'],
        'HOST': os.environ['DATABASE_HOST'],
        'PORT': '5432',
        'CONN_MAX_AGE': 600,
    }
}

# Security
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
```

**Setup and Deploy**:
```bash
# Create Fly Postgres
fly postgres create --name django-db --region iad

# Attach to app
fly postgres attach django-db --app django-app

# Set secrets
fly secrets set SECRET_KEY="$(openssl rand -base64 32)"

# Deploy
fly deploy

# Run migrations
fly ssh console --app django-app -C "python manage.py migrate"
```

---

### Example 3: Go Microservice with gRPC

**fly.toml**:
```toml
app = "grpc-service"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[[services]]
  internal_port = 50051
  protocol = "tcp"

  [[services.ports]]
    port = 50051
    handlers = ["tls"]

  # Health check endpoint
  [[services.tcp_checks]]
    interval = "10s"
    timeout = "2s"
    grace_period = "5s"

# HTTP metrics endpoint
[[services]]
  internal_port = 9090
  protocol = "tcp"

  [[services.ports]]
    port = 9090
    handlers = ["http"]

[vm]
  cpu_kind = "performance"
  cpus = 2
  memory_mb = 2048
```

**Dockerfile**:
```dockerfile
# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server ./cmd/server

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/server .

EXPOSE 50051 9090

CMD ["./server"]
```

**server.go** (gRPC with health check):
```go
package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	// gRPC server
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	s := grpc.NewServer()

	// Register health service
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(s, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)

	// Register your service
	// pb.RegisterYourServiceServer(s, &yourServiceImpl{})

	// Metrics endpoint
	go func() {
		http.Handle("/metrics", promhttp.Handler())
		log.Fatal(http.ListenAndServe(":9090", nil))
	}()

	// Graceful shutdown
	go func() {
		sigterm := make(chan os.Signal, 1)
		signal.Notify(sigterm, syscall.SIGTERM, syscall.SIGINT)
		<-sigterm
		log.Println("Shutting down gracefully...")
		s.GracefulStop()
	}()

	log.Println("gRPC server listening on :50051")
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
```

---

### Example 4: Ruby on Rails API with Sidekiq

**fly.toml**:
```toml
app = "rails-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[processes]
  web = "bundle exec rails server -b 0.0.0.0"
  worker = "bundle exec sidekiq"

[env]
  RAILS_ENV = "production"
  RACK_ENV = "production"

[[services]]
  processes = ["web"]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [services.concurrency]
    type = "requests"
    soft_limit = 50
    hard_limit = 100

[vm]
  memory_mb = 2048
```

**Dockerfile**:
```dockerfile
FROM ruby:3.2-slim

RUN apt-get update && apt-get install -y \
  build-essential \
  postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Gemfile Gemfile.lock ./
RUN bundle install --jobs 4 --retry 3

COPY . .

RUN useradd -m -u 1000 rails && chown -R rails:rails /app
USER rails

EXPOSE 3000

CMD ["bundle", "exec", "rails", "server", "-b", "0.0.0.0"]
```

**config/sidekiq.yml**:
```yaml
:concurrency: 5
:queues:
  - default
  - mailers
  - low_priority
```

**Deploy**:
```bash
# Create Redis
fly redis create --name rails-redis --region iad

# Attach Redis
fly redis attach rails-redis --app rails-api

# Set secrets
fly secrets set SECRET_KEY_BASE="$(rails secret)"

# Deploy
fly deploy

# Scale workers
fly scale count worker=2 --app rails-api
```

---

### Example 5: Elixir Phoenix LiveView

**fly.toml**:
```toml
app = "phoenix-app"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PHX_HOST = "phoenix-app.fly.dev"
  PORT = "4000"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = false  # WebSocket requires persistent connections
  min_machines_running = 2

  [http_service.concurrency]
    type = "connections"
    soft_limit = 1000
    hard_limit = 1500

[[vm]]
  cpu_kind = "shared"
  cpus = 2
  memory_mb = 2048
```

**Dockerfile**:
```dockerfile
FROM hexpm/elixir:1.15.7-erlang-26.1.2-alpine-3.18.4 AS build

WORKDIR /app

RUN mix local.hex --force && \
    mix local.rebar --force

ENV MIX_ENV=prod

COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile

COPY config config
COPY lib lib
COPY assets assets
COPY priv priv

RUN mix assets.deploy
RUN mix compile
RUN mix release

FROM alpine:3.18.4

RUN apk add --no-cache openssl ncurses-libs libstdc++

WORKDIR /app

RUN adduser -D phoenix
USER phoenix

COPY --from=build --chown=phoenix:phoenix /app/_build/prod/rel/my_app ./

ENV HOME=/app

EXPOSE 4000

CMD ["bin/my_app", "start"]
```

**config/runtime.exs**:
```elixir
import Config

if config_env() == :prod do
  database_url = System.get_env("DATABASE_URL") ||
    raise "DATABASE_URL not set"

  config :my_app, MyApp.Repo,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10")

  secret_key_base = System.get_env("SECRET_KEY_BASE") ||
    raise "SECRET_KEY_BASE not set"

  config :my_app, MyAppWeb.Endpoint,
    url: [host: System.get_env("PHX_HOST"), port: 443, scheme: "https"],
    http: [port: String.to_integer(System.get_env("PORT") || "4000")],
    secret_key_base: secret_key_base,
    server: true
end
```

**Deploy**:
```bash
# Create Postgres
fly postgres create --name phoenix-db --region iad

# Attach database
fly postgres attach phoenix-db --app phoenix-app

# Set secrets
fly secrets set SECRET_KEY_BASE="$(mix phx.gen.secret)"

# Deploy
fly deploy

# Run migrations
fly ssh console --app phoenix-app -C "bin/my_app eval 'MyApp.Release.migrate()'"
```

---

### Example 6: Rust Actix-Web API

**fly.toml**:
```toml
app = "rust-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true

  [http_service.concurrency]
    type = "requests"
    soft_limit = 500
    hard_limit = 750

[[vm]]
  cpu_kind = "performance"
  cpus = 2
  memory_mb = 1024
```

**Dockerfile**:
```dockerfile
# Build stage
FROM rust:1.75-alpine AS builder

RUN apk add --no-cache musl-dev

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

COPY src ./src
RUN touch src/main.rs
RUN cargo build --release

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /app/target/release/rust-api .

RUN addgroup -g 1000 rust && \
    adduser -D -u 1000 -G rust rust && \
    chown -R rust:rust /app

USER rust

EXPOSE 8080

CMD ["./rust-api"]
```

---

### Example 7: Java Spring Boot Microservice

**fly.toml**:
```toml
app = "spring-boot-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  JAVA_OPTS = "-Xmx1g -Xms1g -XX:+UseG1GC"

[http_service]
  internal_port = 8080
  force_https = true

[[vm]]
  cpu_kind = "shared"
  cpus = 2
  memory_mb = 2048
```

**Dockerfile**:
```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn clean package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

RUN addgroup -g 1000 spring && \
    adduser -D -u 1000 -G spring spring && \
    chown spring:spring app.jar

USER spring

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
```

---

### Example 8: Static Site with Nginx

**fly.toml**:
```toml
app = "static-site"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
  max_machines_running = 5

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

**Dockerfile**:
```dockerfile
FROM nginx:alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY dist/ /usr/share/nginx/html/

RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
```

**nginx.conf**:
```nginx
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    gzip on;

    server {
        listen 8080;
        root /usr/share/nginx/html;
        index index.html;

        location / {
            try_files $uri $uri/ /index.html;
        }

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

---

### Example 9: Deno Fresh Application

**fly.toml**:
```toml
app = "deno-fresh-app"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

**Dockerfile**:
```dockerfile
FROM denoland/deno:alpine

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno cache main.ts

COPY . .

RUN deno cache main.ts

RUN addgroup -g 1000 deno && \
    adduser -D -u 1000 -G deno deno && \
    chown -R deno:deno /app

USER deno

EXPOSE 8000

CMD ["deno", "run", "-A", "main.ts"]
```

---

### Example 10: WordPress with MySQL

**fly.toml**:
```toml
app = "wordpress-site"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  WORDPRESS_DB_HOST = "mysql.internal:3306"
  WORDPRESS_DB_NAME = "wordpress"

[http_service]
  internal_port = 80
  force_https = true

[mounts]
  source = "wp_content"
  destination = "/var/www/html/wp-content"

[[vm]]
  memory_mb = 1024
```

**Dockerfile**:
```dockerfile
FROM wordpress:php8.2-apache

RUN apt-get update && apt-get install -y \
  libpng-dev \
  libjpeg-dev \
  libfreetype6-dev \
  && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-configure gd --with-freetype --with-jpeg && \
    docker-php-ext-install gd

COPY php.ini /usr/local/etc/php/conf.d/custom.ini

EXPOSE 80
```

**Setup**:
```bash
# Create volume for wp-content
fly volumes create wp_content --region iad --size 10

# Set secrets
fly secrets set WORDPRESS_DB_USER="admin"
fly secrets set WORDPRESS_DB_PASSWORD="$(openssl rand -base64 32)"

# Deploy
fly deploy
```

---

## Database Integration Patterns

### Fly Postgres Setup and Management

**Create Fly Postgres Cluster**:
```bash
# Create with defaults (2 CPUs, 4GB RAM)
fly postgres create --name my-postgres --region iad

# Create with custom specs
fly postgres create \
  --name my-postgres \
  --region iad \
  --vm-size shared-cpu-4x \
  --initial-cluster-size 3 \
  --volume-size 50
```

**Attach to Application**:
```bash
# Attach sets DATABASE_URL automatically
fly postgres attach my-postgres --app my-app

# Manual connection string
postgres://user:pass@my-postgres.internal:5432/dbname?sslmode=disable
```

**High Availability Configuration**:
```bash
# Create 3-node cluster for HA (primary + 2 replicas)
fly postgres create \
  --name prod-postgres \
  --region iad \
  --initial-cluster-size 3

# Add replica in different region
fly postgres attach prod-postgres --app my-app --region lax
```

**Backup and Recovery**:
```bash
# Manual snapshot
fly postgres backup create --app my-postgres

# List backups
fly postgres backup list --app my-postgres

# Restore from backup
fly postgres restore --app my-postgres --snapshot <snapshot-id>

# Point-in-time recovery (PITR)
fly postgres restore --app my-postgres --timestamp "2025-01-15T10:30:00Z"
```

**Connection Pooling with PgBouncer**:
```bash
# Enable PgBouncer (included in Fly Postgres)
# Connection string uses port 5433
postgres://user:pass@my-postgres.internal:5433/dbname?sslmode=disable

# PgBouncer modes:
# - session (default): Connection persists for session
# - transaction: Connection released after each transaction
# - statement: Connection released after each statement
```

**Monitoring and Maintenance**:
```bash
# Check cluster status
fly postgres status --app my-postgres

# View logs
fly postgres logs --app my-postgres

# Connect to PostgreSQL
fly postgres connect --app my-postgres

# Run SQL query
fly postgres connect --app my-postgres -c "SELECT version();"
```

### Redis Integration

**Upstash Redis (Recommended)**:
```bash
# Create Upstash Redis via Fly
fly redis create --name my-redis --region iad

# Attach to app (sets REDIS_URL)
fly redis attach my-redis --app my-app
```

**Self-Hosted Redis**:

**fly.toml**:
```toml
app = "my-redis"
primary_region = "iad"

[build]
  image = "redis:7-alpine"

[[services]]
  internal_port = 6379
  protocol = "tcp"

[mounts]
  source = "redis_data"
  destination = "/data"
```

**Connection in Application**:
```javascript
// Node.js example
const redis = require('redis');
const client = redis.createClient({
  url: process.env.REDIS_URL
});
```

### External Database Integration

**Supabase Postgres**:
```bash
# Set connection string
fly secrets set DATABASE_URL="postgresql://user:pass@db.supabase.co:5432/postgres"

# Use connection pooling
fly secrets set DATABASE_URL="postgresql://user:pass@db.supabase.co:6543/postgres"
```

**PlanetScale MySQL**:
```bash
# Connection with SSL
fly secrets set DATABASE_URL="mysql://user:pass@aws.connect.psdb.cloud/dbname?ssl=true"
```

**Neon Postgres (Serverless)**:
```bash
fly secrets set DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb"
```

**Connection Security Best Practices**:
- Use Fly's private network (`.internal` domains) when possible
- Enable SSL/TLS for external connections
- Rotate credentials regularly
- Use connection pooling for high-traffic apps
- Set connection timeouts and retry logic

---

## Monitoring and Observability

### Log Management

**View Logs in Real-Time**:
```bash
# Tail all logs
fly logs

# Filter by region
fly logs --region iad

# Filter by instance
fly logs --instance 12345678

# JSON output
fly logs --json
```

**Log Streaming to External Services**:
```bash
# Stream to Logtail
fly logs --json | logtail-cli

# Stream to Datadog
fly logs --json | datadog-agent

# Stream to Elasticsearch
fly logs --json | logstash -f logstash.conf
```

**Log Retention**:
- Fly stores logs for 7 days
- Use log streaming for long-term retention
- Consider object storage (S3/Tigris) for archive

### Metrics and Monitoring

**Prometheus Integration**:

**Expose metrics endpoint**:
```go
// Go example
import "github.com/prometheus/client_golang/prometheus/promhttp"

http.Handle("/metrics", promhttp.Handler())
```

**Scrape metrics with Prometheus**:
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'flyio-app'
    static_configs:
      - targets: ['app.fly.dev:9090']
```

**Grafana Dashboard**:
```yaml
# datasource.yaml
apiVersion: 1
datasources:
  - name: Fly.io Metrics
    type: prometheus
    url: http://prometheus:9090
    access: proxy
```

**Custom Metrics Examples**:
```javascript
// Node.js with prom-client
const client = require('prom-client');

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status']
});

// Middleware
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.route?.path, status: res.statusCode });
  });
  next();
});
```

### Alerting

**Email Alerts**:
```bash
# Configure via Fly dashboard
# Settings → Alerts → Add Alert Rule
# Conditions: Health check failures, high memory usage, CPU spikes
```

**Slack Integration**:
```bash
# Webhook URL
fly secrets set SLACK_WEBHOOK="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX"
```

**Custom Alert Script**:
```javascript
// alert.js - Run as cron job
const axios = require('axios');

async function checkHealth() {
  const response = await axios.get('https://app.fly.dev/health');
  if (response.status !== 200) {
    await axios.post(process.env.SLACK_WEBHOOK, {
      text: `🚨 App health check failed: ${response.status}`
    });
  }
}

checkHealth();
```

### Distributed Tracing

**OpenTelemetry Integration**:
```javascript
// Node.js with OpenTelemetry
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

const provider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'my-app',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: 'production',
  }),
});

provider.register();
```

**Jaeger Integration**:
```yaml
# docker-compose.yml for Jaeger
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "14268:14268"
```

---

## Security Hardening Guide

### Private Networking

**Fly 6PN (IPv6 Private Network)**:
```toml
# Internal service (not exposed to internet)
[[services]]
  internal_port = 5432
  protocol = "tcp"

  # No public ports = internal-only
```

**Internal DNS**:
- `app-name.internal` - Load balanced across all instances
- `app-name.fly.dev` - Public DNS
- `region.app-name.internal` - Region-specific routing

**Service-to-Service Communication**:
```javascript
// Connect to internal service
const dbHost = 'postgres-app.internal';
const apiHost = 'api-app.internal:8080';
```

### VPN Access with WireGuard

**Create WireGuard Tunnel**:
```bash
# Create peer
fly wireguard create

# Create additional peer
fly wireguard create personal laptop macos

# List peers
fly wireguard list

# Remove peer
fly wireguard remove <peer-name>
```

**Connect with WireGuard Client**:
1. Install WireGuard: https://www.wireguard.com/install/
2. Add configuration from `fly wireguard create` output
3. Activate tunnel
4. Access internal services: `http://app.internal`

### OAuth/OIDC Authentication

**Example with Auth0**:
```javascript
// Express + Passport.js
const passport = require('passport');
const Auth0Strategy = require('passport-auth0');

passport.use(new Auth0Strategy({
  domain: process.env.AUTH0_DOMAIN,
  clientID: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  callbackURL: 'https://app.fly.dev/callback'
}, (accessToken, refreshToken, extraParams, profile, done) => {
  return done(null, profile);
}));

app.get('/auth/login', passport.authenticate('auth0', { scope: 'openid profile email' }));
app.get('/auth/callback', passport.authenticate('auth0'), (req, res) => {
  res.redirect('/dashboard');
});
```

### Secrets Rotation

**Automated Rotation Script**:
```bash
#!/bin/bash
# rotate-secrets.sh

# Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# Set new secret
fly secrets set DATABASE_PASSWORD="$NEW_SECRET" --app my-app

# Update database user password
fly postgres connect --app my-postgres -c \
  "ALTER USER myuser WITH PASSWORD '$NEW_SECRET';"

echo "✅ Secret rotated successfully"
```

**Schedule with cron** (run monthly):
```bash
0 0 1 * * /path/to/rotate-secrets.sh
```

### Security Best Practices Checklist

**Application Security**:
- [ ] **No Hardcoded Secrets**: Use `fly secrets set`, never commit credentials
- [ ] **Environment Variables**: All sensitive config via secrets API
- [ ] **Least Privilege**: Minimal permissions for service accounts
- [ ] **Input Validation**: Sanitize all user inputs (SQL injection, XSS)
- [ ] **Output Encoding**: Escape output to prevent XSS
- [ ] **Rate Limiting**: Protect against DDoS and brute force
- [ ] **CORS Configuration**: Restrict origins, methods, headers

**Network Security**:
- [ ] **Private Networking**: Use `.internal` for database connections
- [ ] **TLS Everywhere**: Force HTTPS (`force_https = true`)
- [ ] **Security Headers**: HSTS, CSP, X-Frame-Options, etc.
- [ ] **Firewall Rules**: Restrict SSH access, use WireGuard VPN
- [ ] **Internal Services**: No public exposure for admin panels

**Infrastructure Security**:
- [ ] **Non-Root User**: Run containers as non-root user
- [ ] **Minimal Base Image**: Use Alpine or distroless images
- [ ] **Dependency Scanning**: Regular security updates
- [ ] **Image Scanning**: Scan for vulnerabilities (Trivy, Snyk)
- [ ] **Secret Scanning**: Prevent secrets in code (git-secrets, truffleHog)

**Monitoring and Response**:
- [ ] **Audit Logs**: Track authentication, authorization events
- [ ] **Alerting**: Set up alerts for security events
- [ ] **Incident Response**: Document playbook for security incidents
- [ ] **Backup Strategy**: Regular backups with encryption
- [ ] **Disaster Recovery**: Test restore procedures

**Security Headers Example**:
```javascript
// Express.js middleware
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=()');
  next();
});
```

---

## Performance Optimization

### Regional Placement Strategy

**Choose Regions Based on Users**:
```bash
# US-focused app
fly regions add iad lax  # East + West Coast

# Global app
fly regions add iad lhr syd nrt  # US, Europe, Australia, Asia

# List available regions
fly platform regions
```

**Multi-Region Deployment**:
```toml
# Automatic regional routing via Anycast
[http_service]
  auto_stop_machines = false
  min_machines_running = 2  # At least 2 per region

# Deploy to multiple regions
# fly scale count 2 --region iad
# fly scale count 2 --region lhr
```

**Volume Replication**:
```bash
# Create volumes in multiple regions
fly volumes create data --region iad --size 10
fly volumes create data --region lhr --size 10

# Application handles replication (e.g., Litestream for SQLite)
```

### Caching Strategies

**Redis Caching**:
```javascript
// Cache-aside pattern
async function getUser(userId) {
  const cached = await redis.get(`user:${userId}`);
  if (cached) return JSON.parse(cached);

  const user = await db.users.findById(userId);
  await redis.setex(`user:${userId}`, 3600, JSON.stringify(user));
  return user;
}
```

**HTTP Caching Headers**:
```javascript
// Static assets
app.use('/static', express.static('public', {
  maxAge: '1y',
  immutable: true
}));

// API responses
app.get('/api/data', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');  // 5 minutes
  res.json(data);
});
```

**CDN Integration (Cloudflare)**:
```toml
# Cloudflare proxies through Fly.io
# Set up in Cloudflare dashboard:
# 1. Add domain
# 2. Point CNAME to app.fly.dev
# 3. Enable proxy (orange cloud)
# 4. Configure cache rules
```

### Machine Sizing Optimization

**Right-Sizing Process**:
1. **Start Small**: Begin with `shared-cpu-1x`, 1GB RAM
2. **Monitor**: Track CPU, memory, request latency
3. **Identify Bottlenecks**: CPU-bound vs memory-bound vs I/O-bound
4. **Scale Appropriately**: Upgrade CPU/memory or add more machines

**Vertical vs Horizontal Scaling**:
```bash
# Vertical: Upgrade machine size
fly scale vm performance-2x --memory 4096

# Horizontal: Add more machines
fly scale count 5

# Auto-scaling with traffic
fly autoscale set min=2 max=10
```

**Performance Testing**:
```bash
# Load test with k6
k6 run --vus 100 --duration 60s loadtest.js

# Apache Bench
ab -n 10000 -c 100 https://app.fly.dev/

# Analyze metrics
fly metrics
```

### Network Latency Optimization

**Reduce Hops**:
- Deploy close to users (multi-region)
- Use private network for service-to-service communication
- Minimize external API calls

**Connection Pooling**:
```javascript
// PostgreSQL connection pool
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,  // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

**HTTP/2 and HTTP/3**:
```toml
# Fly Proxy automatically uses HTTP/2
# Enable HTTP/3 (QUIC) for faster connections
[http_service]
  protocol = "tcp"
  # HTTP/3 enabled by default for all apps
```

### Database Optimization

**Query Optimization**:
```sql
-- Add indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_posts_user_id ON posts(user_id);

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM posts WHERE user_id = 123;
```

**Read Replicas**:
```bash
# Create read replica in different region
fly postgres attach prod-postgres --app my-app --region lhr --read-only
```

**Connection Pooling with PgBouncer**:
```bash
# Use port 5433 for pooled connections
postgres://user:pass@db.internal:5433/dbname
```

---

## Cost Optimization Strategies

### Right-Sizing Machines

**Machine Size Cost Matrix** (per month):
| Type | vCPU | Memory | Cost/month |
|------|------|--------|------------|
| `shared-cpu-1x` | 1 | 256MB | ~$2 |
| `shared-cpu-1x` | 1 | 1GB | ~$5 |
| `shared-cpu-2x` | 2 | 2GB | ~$15 |
| `performance-1x` | 1 | 2GB | ~$30 |
| `performance-2x` | 2 | 4GB | ~$60 |

**Optimization Tips**:
- Start with shared CPU for dev/staging
- Use performance CPU only for production high-traffic apps
- Monitor CPU/memory usage and downsize if underutilized

### Auto-Scaling and Auto-Stop

**Scale to Zero**:
```toml
[http_service]
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0  # Zero cost when idle
  max_machines_running = 10
```

**Auto-Scaling Based on Traffic**:
```bash
# CLI auto-scaling
fly autoscale set min=2 max=10 --app my-app

# Scale up when CPU > 80% for 2 minutes
# Scale down when CPU < 20% for 5 minutes
```

**Cost Savings Example**:
- Dev environment: Scale to zero overnight (saves ~60% monthly)
- Staging: Scale to 1 machine (saves ~50% vs 2 machines)
- Production: Auto-scale 2-10 machines (pay only for traffic)

### Reserved Capacity (Commitment Pricing)

**Reserved Pricing**:
```bash
# Contact Fly.io for reserved capacity pricing
# Commit to 1-year or 3-year term for discounts
# Typical savings: 20-40% for 1-year, 40-60% for 3-year
```

### Cost Monitoring

**View Current Usage**:
```bash
# Billing dashboard
fly dashboard billing

# Machine usage
fly scale show

# Volume usage
fly volumes list
```

**Budget Alerts**:
```bash
# Set up alerts in Fly.io dashboard
# Alerts for:
# - Monthly spend > $X
# - Machine count > Y
# - Volume storage > Z GB
```

### Optimization Checklist

**Development and Testing**:
- [ ] **Scale to Zero**: Enable auto-stop for dev/staging
- [ ] **Shared CPU**: Use shared CPU machines for non-production
- [ ] **Small Volumes**: Start with 1-5GB volumes, expand as needed
- [ ] **Destroy Unused**: Delete old apps and volumes

**Production**:
- [ ] **Auto-Scaling**: Use min/max to handle traffic spikes
- [ ] **Right-Size**: Monitor and adjust machine size based on usage
- [ ] **Caching**: Implement Redis/CDN to reduce compute
- [ ] **Optimize Images**: Use multi-stage builds, Alpine base images
- [ ] **Database Pooling**: Reduce database connections

**Long-Term**:
- [ ] **Reserved Capacity**: Commit for 1+ years if stable workload
- [ ] **Multi-Tenancy**: Consolidate low-traffic apps on single machine
- [ ] **Archive Data**: Move old data to object storage (Tigris)
- [ ] **Review Monthly**: Analyze usage and optimize quarterly

---

## CI/CD Integration Patterns

### GitHub Actions

**`.github/workflows/deploy.yml`**:
```yaml
name: Deploy to Fly.io

on:
  push:
    branches: [main]

jobs:
  deploy:
    name: Deploy app
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io
        run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

      - name: Verify deployment
        run: |
          flyctl status
          curl -f https://app.fly.dev/health || exit 1
```

**Multi-Environment Deployment**:
```yaml
name: Multi-Environment Deploy

on:
  push:
    branches: [main, develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Staging
        if: github.ref == 'refs/heads/develop'
        run: flyctl deploy --config fly.staging.toml
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

      - name: Deploy to Production
        if: github.ref == 'refs/heads/main'
        run: flyctl deploy --config fly.production.toml
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### GitLab CI

**`.gitlab-ci.yml`**:
```yaml
stages:
  - build
  - deploy

variables:
  DOCKER_DRIVER: overlay2

build:
  stage: build
  image: docker:latest
  services:
    - docker:dind
  script:
    - docker build -t app:$CI_COMMIT_SHORT_SHA .
  only:
    - main

deploy:
  stage: deploy
  image: flyio/flyctl:latest
  script:
    - flyctl deploy --remote-only
  only:
    - main
  environment:
    name: production
    url: https://app.fly.dev
```

### CircleCI

**`.circleci/config.yml`**:
```yaml
version: 2.1

orbs:
  flyio: roikoren/flyio@0.0.1

workflows:
  build-and-deploy:
    jobs:
      - build
      - deploy:
          requires:
            - build
          filters:
            branches:
              only: main

jobs:
  build:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run: npm install
      - run: npm test

  deploy:
    docker:
      - image: cimg/base:2023.01
    steps:
      - checkout
      - run:
          name: Install flyctl
          command: |
            curl -L https://fly.io/install.sh | sh
            export PATH="$HOME/.fly/bin:$PATH"
      - run:
          name: Deploy to Fly.io
          command: |
            export PATH="$HOME/.fly/bin:$PATH"
            flyctl deploy --remote-only
```

### Jenkins

**`Jenkinsfile`**:
```groovy
pipeline {
  agent any

  environment {
    FLY_API_TOKEN = credentials('fly-api-token')
  }

  stages {
    stage('Build') {
      steps {
        sh 'npm install'
        sh 'npm test'
      }
    }

    stage('Deploy') {
      when {
        branch 'main'
      }
      steps {
        sh '''
          curl -L https://fly.io/install.sh | sh
          export PATH="$HOME/.fly/bin:$PATH"
          flyctl deploy --remote-only
        '''
      }
    }

    stage('Verify') {
      steps {
        sh '''
          export PATH="$HOME/.fly/bin:$PATH"
          flyctl status
          curl -f https://app.fly.dev/health
        '''
      }
    }
  }

  post {
    failure {
      mail to: 'team@example.com',
           subject: "Failed Pipeline: ${currentBuild.fullDisplayName}",
           body: "Pipeline failed: ${env.BUILD_URL}"
    }
  }
}
```

### Bitbucket Pipelines

**`bitbucket-pipelines.yml`**:
```yaml
image: node:20

pipelines:
  branches:
    main:
      - step:
          name: Build and Test
          caches:
            - node
          script:
            - npm install
            - npm test

      - step:
          name: Deploy to Fly.io
          deployment: production
          script:
            - curl -L https://fly.io/install.sh | sh
            - export PATH="$HOME/.fly/bin:$PATH"
            - flyctl deploy --remote-only
          services:
            - docker
```

---

## Migration Guides

### AWS → Fly.io

**EC2 → Fly Machines**:
| AWS EC2 | Fly.io Equivalent | Notes |
|---------|-------------------|-------|
| `t3.micro` | `shared-cpu-1x` (256MB) | Dev/test |
| `t3.small` | `shared-cpu-1x` (1GB) | Small apps |
| `t3.medium` | `shared-cpu-2x` (2GB) | Medium apps |
| `c5.large` | `performance-2x` (4GB) | High traffic |

**ECS/Fargate → Fly Machines**:
- Task definition → `fly.toml`
- Service → `[http_service]` with auto-scaling
- Load balancer → Fly Proxy (automatic)
- Service discovery → `.internal` DNS

**Lambda → Fly Machines**:
- Function → Containerized app with auto-stop
- API Gateway → Fly Proxy
- Cold start → <1s with Fly Machines
- Billing → Per-second (similar to Lambda)

**RDS → Fly Postgres**:
```bash
# Export from RDS
pg_dump -h rds-host.amazonaws.com -U user -d database > dump.sql

# Create Fly Postgres
fly postgres create --name my-db --region iad

# Import
fly postgres connect --app my-db < dump.sql
```

**S3 → Tigris**:
```bash
# Install Tigris CLI
brew install tigrisdata/tap/tigris

# Create bucket
tigris create bucket my-bucket

# Sync from S3
aws s3 sync s3://old-bucket/ tigris://my-bucket/
```

### Kubernetes → Fly.io

**Resource Mapping**:
| Kubernetes | Fly.io Equivalent |
|------------|-------------------|
| `Deployment` | `fly.toml` with `min_machines_running` |
| `Service` | `[http_service]` or `[[services]]` |
| `Ingress` | Fly Proxy (automatic HTTPS) |
| `ConfigMap` | `[env]` section |
| `Secret` | `fly secrets set` |
| `PersistentVolume` | Fly Volumes |
| `HorizontalPodAutoscaler` | `fly autoscale set` |

**Example Conversion**:

**Kubernetes `deployment.yaml`**:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
      - name: web
        image: myapp:latest
        ports:
        - containerPort: 8080
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
```

**Fly.io `fly.toml`**:
```toml
app = "web-app"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  min_machines_running = 3

# Set secret with CLI
# fly secrets set DATABASE_URL="postgres://..."
```

### Heroku → Fly.io

**Procfile → fly.toml**:

**Heroku `Procfile`**:
```
web: npm start
worker: node worker.js
```

**Fly.io `fly.toml`**:
```toml
[processes]
  web = "npm start"
  worker = "node worker.js"

[[services]]
  processes = ["web"]
  internal_port = 8080
```

**Add-ons Mapping**:
| Heroku Add-on | Fly.io Equivalent |
|---------------|-------------------|
| Heroku Postgres | Fly Postgres |
| Heroku Redis | Upstash Redis |
| Heroku Data for Redis | Upstash Redis |
| Papertrail | Log streaming |
| New Relic | Prometheus + Grafana |
| Sendgrid | External API (same) |
| Cloudinary | Tigris + CDN |

**Buildpacks → Dockerfile**:
```bash
# Heroku uses buildpacks automatically
# Fly.io uses Dockerfile (more control)

# Generate Dockerfile from buildpack
heroku buildpacks:search nodejs
# Then create Dockerfile based on Node.js best practices
```

**Migration Process**:
```bash
# 1. Export Heroku config
heroku config --app heroku-app > .env

# 2. Create Fly app
fly launch

# 3. Set secrets from .env
cat .env | grep -v '^#' | while read line; do
  key=$(echo $line | cut -d= -f1)
  value=$(echo $line | cut -d= -f2-)
  fly secrets set "$key=$value"
done

# 4. Migrate database
heroku pg:backups:capture --app heroku-app
heroku pg:backups:download --app heroku-app
fly postgres connect --app fly-db < latest.dump

# 5. Deploy
fly deploy

# 6. Test and switch DNS
# Update DNS to point to Fly.io
```

---

## Platform Comparison Matrix

| Feature | Fly.io | AWS | Kubernetes | Heroku |
|---------|--------|-----|------------|--------|
| **Ease of Use** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Pricing** | $$$ | $$$$$ | $$$$ | $$$$ |
| **Global Network** | 30+ regions | 33 regions | Self-managed | US/Europe |
| **Auto-Scaling** | Yes | Yes | Yes | Yes |
| **Cold Start** | <1s | Varies | Varies | ~10s |
| **Databases** | Postgres, Redis | All | Self-managed | Postgres, Redis |
| **Free Tier** | Yes (3 shared machines) | Yes (12 months) | No | Yes (1 dyno) |
| **SSL/TLS** | Automatic | Manual (ACM) | Manual (cert-manager) | Automatic |
| **WebSockets** | Native | Yes (ALB) | Yes | Yes |
| **IPv6** | Native | Manual | Manual | No |
| **Deployment Speed** | ~30s | Varies | Varies | ~60s |
| **Learning Curve** | Low | High | Very High | Low |

---

This comprehensive reference guide completes your Fly.io skill system with advanced patterns, production examples, and complete migration strategies. Use alongside SKILL.md for the complete Fly.io development experience.

**File Size**: ~47KB (under 50KB target)
**Production Examples**: 10 complete examples included
**Security**: Comprehensive hardening checklist
**CI/CD**: Major platform integrations covered
**Migrations**: AWS, Kubernetes, Heroku guides complete
