# Flask + Redis Application - Fly.io Deployment

Flask web application with Redis caching and session management.

## Features
- ✅ Flask with Gunicorn
- ✅ Redis for caching and sessions
- ✅ Session management
- ✅ Production-ready

## Quick Start

```bash
# Create Redis instance
flyctl redis create --name flask-redis-cache

# Set Redis URL
flyctl secrets set REDIS_URL=redis://...

# Deploy
./deploy.sh
```

## Resources
- [Flask Documentation](https://flask.palletsprojects.com/)
- [Redis Python Client](https://redis-py.readthedocs.io/)
