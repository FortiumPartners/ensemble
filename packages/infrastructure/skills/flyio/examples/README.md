# Fly.io Deployment Examples

Production-ready templates for deploying common application types to Fly.io.

## 📚 Available Templates

### Node.js Applications

#### 1. [Express API](./nodejs-express-api/)
RESTful API with health checks and graceful shutdown.

**Use Cases:**
- RESTful APIs
- Microservices
- Backend services

**Stack:** Node.js 20, Express, Gunicorn
**Image Size:** ~100MB
**Memory:** 256MB
**Startup:** <5 seconds

```bash
cd nodejs-express-api
flyctl apps create my-express-api
./deploy.sh
```

---

#### 2. [Next.js Web](./nodejs-nextjs-web/)
Full-stack React application with standalone build optimization.

**Use Cases:**
- React web applications
- Server-side rendering
- Static + dynamic pages

**Stack:** Next.js 14, React 18, Node.js 20
**Image Size:** ~100MB (standalone)
**Memory:** 512MB
**Features:** SSR, ISR, API routes, image optimization

```bash
cd nodejs-nextjs-web
flyctl apps create my-nextjs-app
./deploy.sh
```

---

#### 3. [NestJS Microservice](./nodejs-nestjs-microservice/)
Enterprise-grade microservice with dependency injection.

**Use Cases:**
- Enterprise APIs
- Microservices architecture
- TypeScript backends

**Stack:** NestJS 10, TypeScript, Terminus health checks
**Image Size:** ~120MB
**Memory:** 512MB
**Features:** DI, modules, decorators, graceful shutdown

```bash
cd nodejs-nestjs-microservice
flyctl apps create my-nestjs-service
./deploy.sh
```

---

### Python Applications

#### 4. [Django Web](./python-django-web/)
Full-featured Django application with Celery workers.

**Use Cases:**
- Web applications
- Admin interfaces
- Content management

**Stack:** Django 5.0, PostgreSQL, Celery, Redis
**Image Size:** ~200MB
**Memory:** 512MB
**Features:** ORM, admin, migrations, background jobs

```bash
cd python-django-web
flyctl apps create my-django-app
flyctl postgres create --name django-db
flyctl postgres attach django-db
./deploy.sh
```

---

#### 5. [FastAPI Async](./python-fastapi-async/)
High-performance async API with automatic documentation.

**Use Cases:**
- High-throughput APIs
- Async workloads
- ML model serving

**Stack:** FastAPI, Uvicorn, Pydantic v2, async/await
**Image Size:** ~100MB
**Memory:** 256MB
**Features:** OpenAPI docs, async operations, validation

```bash
cd python-fastapi-async
flyctl apps create my-fastapi
./deploy.sh
```

---

#### 6. [Flask + Redis](./python-flask-redis/)
Lightweight Flask API with Redis caching.

**Use Cases:**
- Small APIs
- Caching layers
- Session management

**Stack:** Flask 3.0, Redis, Gunicorn
**Image Size:** ~80MB
**Memory:** 256MB
**Features:** Caching, sessions, simple routing

```bash
cd python-flask-redis
flyctl apps create my-flask-app
flyctl redis create --name flask-cache
./deploy.sh
```

---

### Go Applications

#### 7. [Go HTTP Server](./go-http-server/)
Minimal, high-performance Go server.

**Use Cases:**
- High-performance APIs
- Low-latency services
- Minimal resource usage

**Stack:** Go 1.21, net/http
**Image Size:** ~10MB
**Memory:** 256MB (uses ~10MB)
**Startup:** <1 second
**Performance:** 10,000+ req/s

```bash
cd go-http-server
flyctl apps create my-go-server
./deploy.sh
```

---

### Ruby Applications

#### 8. [Rails API](./ruby-rails-api/)
Rails API mode with Sidekiq background jobs.

**Use Cases:**
- Ruby APIs
- Background processing
- Rails ecosystem

**Stack:** Rails 7.1, PostgreSQL, Sidekiq, Redis
**Image Size:** ~150MB
**Memory:** 512MB
**Features:** ActiveRecord, migrations, jobs

```bash
cd ruby-rails-api
flyctl apps create my-rails-api
flyctl postgres create --name rails-db
./deploy.sh
```

---

### Elixir Applications

#### 9. [Phoenix LiveView](./elixir-phoenix-liveview/)
Real-time Phoenix application with distributed Erlang.

**Use Cases:**
- Real-time web apps
- Live updates
- Distributed systems

**Stack:** Phoenix 1.7, Elixir 1.16, LiveView
**Image Size:** ~100MB
**Memory:** 512MB
**Features:** WebSockets, PubSub, clustering

```bash
cd elixir-phoenix-liveview
flyctl apps create my-phoenix-app
./deploy.sh
```

---

### Static Sites

#### 10. [Static Site](./static-site/)
Optimized nginx deployment for static content.

**Use Cases:**
- Static websites
- SPAs (React, Vue, Angular)
- Documentation sites

**Stack:** nginx Alpine
**Image Size:** ~10MB
**Memory:** 256MB
**Features:** Gzip, security headers, SPA routing, scale to zero

```bash
cd static-site
# Build your static site first
npm run build
cp -r build/* dist/

flyctl apps create my-static-site
./deploy.sh
```

---

### Background Workers

#### 11. [Background Worker](./background-worker/)
Celery worker for processing background jobs (no HTTP).

**Use Cases:**
- Job processing
- Scheduled tasks
- Heavy computations

**Stack:** Celery 5.3, Redis, Python 3.12
**Image Size:** ~100MB
**Memory:** 512MB
**Features:** Task queues, retry logic, concurrency

```bash
cd background-worker
flyctl apps create my-worker
flyctl redis create --name worker-queue
./deploy.sh
```

---

### Multi-Region

#### 12. [Multi-Region Deployment](./multi-region/)
Global deployment across multiple geographic regions.

**Use Cases:**
- Global applications
- Low latency worldwide
- High availability

**Stack:** Node.js (example), any stack works
**Regions:** SEA, IAD, AMS, FRA, NRT, SYD, etc.
**Features:** Automatic routing, request replay, regional scaling

```bash
cd multi-region
flyctl apps create my-global-app
./deploy.sh  # Automatically deploys to multiple regions
```

---

## 🚀 Quick Start Guide

### 1. Install Fly.io CLI

```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh

# Windows
iwr https://fly.io/install.ps1 -useb | iex
```

### 2. Login to Fly.io

```bash
flyctl auth login
```

### 3. Choose a Template

Browse examples above and choose one that fits your needs.

### 4. Deploy

```bash
cd <template-directory>
flyctl apps create <your-app-name>
./deploy.sh
```

## 📖 Template Structure

Each template includes:

- **fly.toml** - Fly.io configuration
- **Dockerfile** - Multi-stage build with security best practices
- **deploy.sh** - Deployment script with validation
- **README.md** - Detailed setup and usage instructions
- **Example code** - Working application skeleton

## 🔐 Security Best Practices

All templates follow security best practices:

✅ **Non-root containers** - All apps run as non-root user
✅ **Multi-stage builds** - Minimal production images
✅ **No hardcoded secrets** - Use `flyctl secrets set`
✅ **Health checks** - Proper liveness/readiness probes
✅ **Graceful shutdown** - SIGTERM handling
✅ **Security headers** - XSS, CSRF, CSP protection

## 🎯 Common Patterns

### Database Setup

```bash
# PostgreSQL
flyctl postgres create --name myapp-db
flyctl postgres attach myapp-db

# Redis
flyctl redis create --name myapp-cache
# Get connection URL from dashboard
flyctl secrets set REDIS_URL=redis://...
```

### Setting Secrets

```bash
# Set secrets
flyctl secrets set SECRET_KEY=your-secret-value
flyctl secrets set DATABASE_URL=postgres://...

# List secrets (values hidden)
flyctl secrets list

# Remove secret
flyctl secrets unset SECRET_KEY
```

### Scaling

```bash
# Vertical scaling (more CPU/memory)
flyctl scale vm shared-cpu-2x --memory 1024

# Horizontal scaling (more machines)
flyctl scale count 3

# Regional scaling
flyctl scale count 2 --region sea
flyctl scale count 1 --region ams
```

### Monitoring

```bash
# View logs
flyctl logs

# Check status
flyctl status

# View metrics
flyctl metrics

# Open dashboard
flyctl dashboard
```

## 🏗️ Architecture Patterns

### Stateless Applications
- Express API
- FastAPI
- Go HTTP Server
- Static Site

**Best for:** APIs, microservices, SPAs

### Stateful Applications
- Django (with PostgreSQL)
- Rails (with PostgreSQL)
- Phoenix (with PostgreSQL)

**Best for:** Web applications, admin interfaces

### Background Workers
- Celery Worker
- Sidekiq (Rails)

**Best for:** Job processing, scheduled tasks

### Multi-Process
- Django (web + worker)
- Rails (web + Sidekiq)

**Best for:** Applications with background jobs

## 📊 Performance Comparison

| Template | Image Size | Memory | Startup | Req/s |
|----------|-----------|---------|---------|-------|
| Go HTTP Server | ~10MB | 10MB | <1s | 10,000+ |
| Static Site | ~10MB | 20MB | <1s | 50,000+ |
| FastAPI | ~100MB | 50MB | <5s | 5,000+ |
| Express API | ~100MB | 50MB | <5s | 3,000+ |
| Next.js | ~100MB | 100MB | <10s | 2,000+ |
| NestJS | ~120MB | 80MB | <10s | 2,500+ |
| Flask | ~80MB | 40MB | <5s | 3,000+ |
| Rails | ~150MB | 150MB | <15s | 1,000+ |
| Django | ~200MB | 200MB | <20s | 1,500+ |
| Phoenix | ~100MB | 100MB | <10s | 8,000+ |

*Approximate values for comparison*

## 🌍 Regional Deployment

Deploy globally for low latency:

```bash
# Add regions
flyctl regions add iad ams fra nrt syd

# Scale per region
flyctl scale count 2 --region sea  # US West
flyctl scale count 2 --region iad  # US East
flyctl scale count 1 --region ams  # Europe
```

**Available Regions:**
- **Americas:** sea, sjc, lax, iad, ord, dfw, mia, yyz, gru
- **Europe:** ams, fra, lhr, cdg, mad, arn
- **Asia-Pacific:** nrt, hkg, sin, syd

## 💰 Cost Optimization

### Free Tier

Fly.io provides free allowance:
- 3 shared-cpu-1x VMs with 256MB RAM
- 3GB storage
- 160GB outbound data transfer

### Cost Reduction Tips

1. **Use smaller VMs** - shared-cpu-1x for most apps
2. **Scale to zero** - For low-traffic apps
3. **Optimize images** - Multi-stage builds
4. **Choose regions wisely** - US regions often cheaper
5. **Use auto-stop** - For development apps

## 🔧 Troubleshooting

### Deployment fails

```bash
# Validate configuration
flyctl config validate

# Check build logs
flyctl deploy --remote-only --verbose

# SSH into machine
flyctl ssh console
```

### App not responding

```bash
# Check logs
flyctl logs --lines 100

# Check health
flyctl checks list

# Restart app
flyctl apps restart
```

### High memory usage

```bash
# Check current usage
flyctl status

# Scale memory
flyctl scale vm shared-cpu-1x --memory 512
```

## 📚 Additional Resources

- [Fly.io Documentation](https://fly.io/docs/)
- [Fly.io Blog](https://fly.io/blog/)
- [Community Forum](https://community.fly.io/)
- [Status Page](https://status.fly.io/)

## 🤝 Contributing

To add a new template:

1. Create directory: `examples/your-template/`
2. Include: `fly.toml`, `Dockerfile`, `deploy.sh`, `README.md`
3. Follow security best practices
4. Test deployment
5. Update this README

## 📄 License

These examples are provided as-is for use with Fly.io deployments.

---

**Need help?** Check individual template READMEs or visit [Fly.io Community](https://community.fly.io/)
