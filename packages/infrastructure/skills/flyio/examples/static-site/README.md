# Static Site - Fly.io Deployment

Optimized static site deployment with nginx.

## Features
- ✅ Minimal nginx Alpine image (~10MB)
- ✅ Gzip compression
- ✅ Security headers
- ✅ SPA routing support
- ✅ Scale to zero when idle
- ✅ Asset caching

## Quick Start

```bash
# Build your static site
npm run build  # or your build command

# Copy files to dist/
cp -r build/* dist/

# Deploy
flyctl apps create static-site
./deploy.sh
```

## Configuration

### Custom Domain

```bash
flyctl certs add yourdomain.com
```

### CDN Integration

For best performance, consider Fly.io CDN or Cloudflare.

## Resources
- [nginx Documentation](https://nginx.org/en/docs/)
- [Fly.io Static Sites](https://fly.io/docs/languages-and-frameworks/static/)
