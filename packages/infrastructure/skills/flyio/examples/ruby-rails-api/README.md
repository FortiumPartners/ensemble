# Ruby on Rails API - Fly.io Deployment

Production-ready Rails 7 API with Sidekiq background jobs.

## Features
- ✅ Rails 7 API mode
- ✅ PostgreSQL database
- ✅ Sidekiq background jobs
- ✅ Puma web server
- ✅ Automatic migrations on deploy

## Quick Start

```bash
# Create PostgreSQL
flyctl postgres create --name rails-api-db
flyctl postgres attach rails-api-db

# Set secrets
flyctl secrets set SECRET_KEY_BASE=$(rails secret)

# Deploy
./deploy.sh
```

## Resources
- [Rails Deployment](https://guides.rubyonrails.org/deployment.html)
- [Fly.io Rails Guide](https://fly.io/docs/languages-and-frameworks/rails/)
