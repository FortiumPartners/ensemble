# Node.js Express API - Fly.io Deployment

Production-ready Express API template optimized for Fly.io deployment.

## Features

- ✅ Multi-stage Docker build for minimal image size
- ✅ Health check endpoints
- ✅ Graceful shutdown handling
- ✅ Non-root container user
- ✅ Auto-scaling configuration
- ✅ Production-ready logging

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [Fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/)
- Fly.io account

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Local Development

```bash
npm run dev
```

Access at: `http://localhost:8080`

### 3. Deploy to Fly.io

```bash
# Login to Fly.io
flyctl auth login

# Create new app (first time only)
flyctl apps create express-api

# Set secrets (example)
flyctl secrets set API_KEY=your-secret-key

# Deploy
./deploy.sh
```

## Configuration

### Environment Variables

Configure in `fly.toml` or set as secrets:

```bash
flyctl secrets set DATABASE_URL=postgres://...
flyctl secrets set API_KEY=secret-value
```

### Scaling

```bash
# Scale vertically
flyctl scale vm shared-cpu-2x

# Scale horizontally
flyctl scale count 3

# Auto-scaling (already configured in fly.toml)
# Machines automatically start/stop based on traffic
```

## Health Checks

- **Endpoint**: `GET /health`
- **Interval**: 30 seconds
- **Timeout**: 5 seconds
- **Grace Period**: 10 seconds

## Security

- Container runs as non-root user (uid: 1001)
- HTTPS enforced
- No hardcoded credentials
- Production dependencies only

## Monitoring

```bash
# View logs
flyctl logs

# Check status
flyctl status

# Open dashboard
flyctl dashboard
```

## Troubleshooting

### Deployment fails

```bash
# Validate configuration
flyctl config validate

# Check build logs
flyctl deploy --remote-only --verbose
```

### App not responding

```bash
# Check machine status
flyctl status

# View recent logs
flyctl logs --lines 100

# SSH into machine
flyctl ssh console
```

## Production Checklist

- [ ] Set all required secrets
- [ ] Configure database connection
- [ ] Set up monitoring/alerts
- [ ] Configure backup strategy
- [ ] Review resource allocation
- [ ] Test health checks
- [ ] Set up CI/CD pipeline

## Resources

- [Fly.io Documentation](https://fly.io/docs/)
- [Express Best Practices](https://expressjs.com/en/advanced/best-practice-performance.html)
- [Node.js Production Practices](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)
