# Django Web Application - Fly.io Deployment

Production-ready Django template with Gunicorn, PostgreSQL, and Celery support.

## Features

- ✅ Django 5.0 with production settings
- ✅ Gunicorn WSGI server with optimal workers
- ✅ PostgreSQL database integration
- ✅ Celery for background tasks
- ✅ Static file serving with WhiteNoise
- ✅ Security best practices
- ✅ Multi-process support (web + worker)

## Prerequisites

- [Python 3.12+](https://www.python.org/)
- [Fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/)
- Fly.io account
- PostgreSQL database (Fly Postgres recommended)

## Quick Start

### 1. Create Virtual Environment

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Local Development

```bash
# Set environment variables
export SECRET_KEY=your-secret-key
export DATABASE_URL=postgres://localhost/myapp

# Run migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Run development server
python manage.py runserver
```

### 4. Deploy to Fly.io

```bash
# Login to Fly.io
flyctl auth login

# Create new app
flyctl apps create django-web

# Create PostgreSQL database
flyctl postgres create --name django-web-db
flyctl postgres attach django-web-db

# Set secrets
flyctl secrets set SECRET_KEY=$(python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())')

# Deploy
./deploy.sh
```

## Configuration

### Required Secrets

```bash
# Django secret key (auto-generated recommended)
flyctl secrets set SECRET_KEY=$(python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())')

# Database (auto-set when using flyctl postgres attach)
flyctl secrets set DATABASE_URL=postgres://...

# Optional: Email backend
flyctl secrets set EMAIL_HOST_USER=smtp-user
flyctl secrets set EMAIL_HOST_PASSWORD=smtp-password

# Optional: Sentry for error tracking
flyctl secrets set SENTRY_DSN=https://...
```

### Django Settings

**config/settings/production.py**:

```python
import os
from decouple import config
import dj_database_url

SECRET_KEY = config('SECRET_KEY')
DEBUG = False
ALLOWED_HOSTS = ['*.fly.dev', 'yourdomain.com']

# Database
DATABASES = {
    'default': dj_database_url.config(
        default=config('DATABASE_URL'),
        conn_max_age=600
    )
}

# Static files
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Security
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
```

## Background Tasks with Celery

### Worker Process

The `fly.toml` includes a worker process for Celery:

```toml
[processes]
  web = "gunicorn ..."
  worker = "celery -A config worker -l info"
```

### Create Redis for Celery

```bash
# Create Redis instance for Celery broker
flyctl redis create --name django-web-redis

# Set Redis URL
flyctl secrets set REDIS_URL=redis://...
```

### Configure Celery

**config/celery.py**:

```python
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')

app = Celery('config')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

## Static Files

Static files are served using WhiteNoise for efficiency:

1. **Collect static files** during build (done in Dockerfile)
2. **Serve via WhiteNoise** in production
3. **CDN integration** (optional) for better performance

## Database Migrations

Run migrations after deployment:

```bash
# One-time migration
flyctl ssh console -C "python manage.py migrate"

# Add to deployment script
./deploy.sh  # Automatically runs migrations
```

## Admin Interface

Create superuser:

```bash
flyctl ssh console -C "python manage.py createsuperuser"
```

Access admin at: `https://your-app.fly.dev/admin/`

## Scaling

```bash
# Scale web processes
flyctl scale count 3

# Scale worker processes
flyctl scale count 2 --process-group worker

# Scale vertically
flyctl scale vm shared-cpu-2x --memory 1024
```

## Monitoring

```bash
# View logs
flyctl logs

# Filter by process
flyctl logs --process web
flyctl logs --process worker

# Check status
flyctl status

# Database metrics
flyctl postgres db list -a django-web-db
```

## Troubleshooting

### Static files not loading

```bash
# Rebuild and collect static files
flyctl deploy --remote-only

# Verify static files exist
flyctl ssh console -C "ls -la /app/staticfiles"
```

### Database connection errors

```bash
# Check DATABASE_URL is set
flyctl secrets list

# Test connection
flyctl ssh console -C "python manage.py dbshell"
```

### Worker not processing tasks

```bash
# Check worker logs
flyctl logs --process worker

# Verify Redis connection
flyctl ssh console -C "python -c 'import redis; r=redis.from_url(\"$REDIS_URL\"); print(r.ping())'"
```

## Production Checklist

- [ ] Set SECRET_KEY
- [ ] Configure DATABASE_URL
- [ ] Set up Redis for Celery
- [ ] Configure email backend
- [ ] Set ALLOWED_HOSTS
- [ ] Enable HTTPS settings
- [ ] Set up error tracking (Sentry)
- [ ] Configure static file serving
- [ ] Run database migrations
- [ ] Create superuser
- [ ] Set up backup strategy
- [ ] Configure monitoring/alerts

## Resources

- [Django Deployment Checklist](https://docs.djangoproject.com/en/5.0/howto/deployment/checklist/)
- [Fly.io Django Guide](https://fly.io/docs/languages-and-frameworks/django/)
- [Gunicorn Documentation](https://docs.gunicorn.org/)
- [Celery Best Practices](https://docs.celeryq.dev/en/stable/userguide/tasks.html)
