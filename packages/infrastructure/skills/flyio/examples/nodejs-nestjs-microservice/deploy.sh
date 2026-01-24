#!/bin/bash
# Fly.io deployment script for NestJS microservice
set -e

echo "🚀 Deploying NestJS microservice to Fly.io..."

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
    echo "❌ flyctl not found. Install: https://fly.io/docs/hands-on/install-flyctl/"
    exit 1
fi

# Validate configuration
echo "📋 Validating configuration..."
flyctl config validate

# Deploy with remote builder
echo "🔨 Building and deploying..."
flyctl deploy --remote-only

# Check health
echo "🏥 Checking health endpoints..."
sleep 5
flyctl status

echo ""
echo "✅ Deployment complete!"
echo "📊 Health check: https://$(flyctl info --json | jq -r '.Hostname')/health"
echo "📝 View logs: flyctl logs"
