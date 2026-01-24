#!/bin/bash
set -e
echo "🚀 Deploying multi-region app to Fly.io..."

# Validate configuration
flyctl config validate

# Initial deployment
echo "📦 Deploying application..."
flyctl deploy --remote-only

# Add regions
echo "🌍 Adding regions..."
flyctl regions add iad ams fra

# Scale per region
echo "📊 Scaling by region..."
flyctl scale count 2 --region sea  # US West
flyctl scale count 2 --region iad  # US East
flyctl scale count 1 --region ams  # Europe (Amsterdam)
flyctl scale count 1 --region fra  # Europe (Frankfurt)

# Show deployment status
echo ""
echo "✅ Multi-region deployment complete!"
flyctl status
echo ""
flyctl regions list
echo ""
echo "🌐 Your app is deployed globally!"
echo "📊 Check region distribution: flyctl status"
