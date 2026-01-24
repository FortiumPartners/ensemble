#!/bin/bash
# Fly.io deployment script for Next.js
set -e

echo "🚀 Deploying Next.js app to Fly.io..."

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
echo "🌐 Your Next.js app is live!"
echo "📝 View logs: flyctl logs"
