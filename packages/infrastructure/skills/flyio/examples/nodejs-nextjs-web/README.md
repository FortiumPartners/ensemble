# Next.js Web Application - Fly.io Deployment

Production-optimized Next.js template with standalone build for Fly.io.

## Features

- ✅ Standalone build for minimal Docker image
- ✅ Multi-stage build optimization
- ✅ Static asset optimization
- ✅ Security headers configured
- ✅ Image optimization (AVIF, WebP)
- ✅ Health check endpoints
- ✅ Auto-scaling support

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

Access at: `http://localhost:3000`

### 3. Deploy to Fly.io

```bash
# Login to Fly.io
flyctl auth login

# Create new app
flyctl apps create nextjs-web

# Set environment variables
flyctl secrets set NEXT_PUBLIC_API_URL=https://api.example.com

# Deploy
./deploy.sh
```

## Configuration

### Environment Variables

**Public variables** (exposed to browser, prefix with `NEXT_PUBLIC_`):

```bash
flyctl secrets set NEXT_PUBLIC_API_URL=https://api.example.com
```

**Private variables** (server-side only):

```bash
flyctl secrets set DATABASE_URL=postgres://...
flyctl secrets set API_SECRET=secret-value
```

### Next.js Configuration

Customize `next.config.js` for:
- Image domains
- Redirects/rewrites
- Custom headers
- Environment-specific settings

## Standalone Build

This template uses Next.js standalone output mode for optimal Docker builds:

**Benefits:**
- Minimal image size (~100MB vs ~1GB)
- Faster deployments
- Only production dependencies

**Configuration:**
```js
// next.config.js
module.exports = {
  output: 'standalone'
}
```

## Health Checks

Create `app/api/health/route.ts`:

```typescript
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  })
}
```

## Static Assets

Static assets are automatically optimized:
- Images: AVIF, WebP formats
- CSS/JS: Minified and compressed
- Fonts: Optimized loading

## Security

- Security headers configured in `next.config.js`
- Non-root container user
- HTTPS enforced
- XSS protection enabled
- Content Security Policy ready

## Scaling

```bash
# Scale vertically (increase memory/CPU)
flyctl scale vm shared-cpu-2x --memory 1024

# Scale horizontally (more machines)
flyctl scale count 3

# Regional scaling
flyctl regions add iad ams
```

## Monitoring

```bash
# View logs
flyctl logs

# Check performance
flyctl status

# Open dashboard
flyctl dashboard
```

## Troubleshooting

### Build fails with "Module not found"

```bash
# Clear Next.js cache locally
rm -rf .next
npm run build

# Rebuild on Fly.io
flyctl deploy --remote-only --no-cache
```

### Images not loading

Configure image domains in `next.config.js`:

```js
images: {
  domains: ['example.com', 'cdn.example.com']
}
```

### High memory usage

Increase memory allocation:

```bash
flyctl scale vm shared-cpu-1x --memory 512
```

## Production Checklist

- [ ] Configure all environment variables
- [ ] Set up image optimization domains
- [ ] Configure security headers
- [ ] Test health check endpoint
- [ ] Set up monitoring/alerts
- [ ] Configure CDN (optional)
- [ ] Test in production environment
- [ ] Set up backup strategy

## Resources

- [Next.js Deployment Docs](https://nextjs.org/docs/deployment)
- [Fly.io Next.js Guide](https://fly.io/docs/languages-and-frameworks/nextjs/)
- [Standalone Output](https://nextjs.org/docs/advanced-features/output-file-tracing)
