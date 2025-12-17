#!/bin/bash
# Fly.io deployment script for Django
set -e

echo "🚀 Deploying Django application to Fly.io..."

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
    echo "❌ flyctl not found. Install: https://fly.io/docs/hands-on/install-flyctl/"
    exit 1
fi

# Validate configuration
echo "📋 Validating configuration..."
flyctl config validate

# Check for required secrets
echo "🔐 Checking required secrets..."
REQUIRED_SECRETS=("SECRET_KEY" "DATABASE_URL")
for secret in "${REQUIRED_SECRETS[@]}"; do
    if ! flyctl secrets list | grep -q "$secret"; then
        echo "⚠️  Warning: $secret not set. Set with: flyctl secrets set $secret=..."
    fi
done

# Deploy with remote builder
echo "🔨 Building and deploying..."
flyctl deploy --remote-only

# Run database migrations
echo "🗄️  Running migrations..."
flyctl ssh console -C "python manage.py migrate"

# Check deployment status
echo "✅ Deployment complete!"
flyctl status

echo ""
echo "🌐 Your Django app is live!"
echo "📊 Admin: https://$(flyctl info --json | jq -r '.Hostname')/admin/"
echo "📝 View logs: flyctl logs"
