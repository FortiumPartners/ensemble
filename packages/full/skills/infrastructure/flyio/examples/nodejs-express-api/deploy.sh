#!/bin/bash
# Fly.io deployment script for Express API
set -e

echo "🚀 Deploying Express API to Fly.io..."

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
    echo "❌ flyctl not found. Install: https://fly.io/docs/hands-on/install-flyctl/"
    exit 1
fi

# Check if fly.toml exists
if [ ! -f "fly.toml" ]; then
    echo "❌ fly.toml not found. Run from project root."
    exit 1
fi

# Validate configuration
echo "📋 Validating configuration..."
flyctl config validate

# Deploy with remote builder (recommended)
echo "🔨 Building and deploying..."
flyctl deploy --remote-only

# Check deployment status
echo "✅ Deployment complete!"
echo "📊 Checking app status..."
flyctl status

echo ""
echo "🌐 Your app is live at: https://$(flyctl info --json | jq -r '.Hostname')"
echo "📝 View logs: flyctl logs"
echo "🔍 Monitor: flyctl dashboard"
