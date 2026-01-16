#!/bin/bash
set -e
echo "🚀 Deploying background worker to Fly.io..."
flyctl config validate

# Check Redis connection
if ! flyctl secrets list | grep -q "REDIS_URL"; then
    echo "⚠️  Warning: REDIS_URL not set. Set with: flyctl secrets set REDIS_URL=..."
fi

flyctl deploy --remote-only
flyctl status
