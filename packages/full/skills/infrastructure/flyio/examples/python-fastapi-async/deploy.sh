#!/bin/bash
# Fly.io deployment script for FastAPI
set -e

echo "🚀 Deploying FastAPI application to Fly.io..."

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

# Check deployment status
echo "✅ Deployment complete!"
flyctl status

echo ""
echo "🌐 Your FastAPI app is live!"
echo "📚 API docs: https://$(flyctl info --json | jq -r '.Hostname')/docs"
echo "📝 View logs: flyctl logs"
