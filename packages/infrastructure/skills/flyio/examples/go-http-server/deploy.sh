#!/bin/bash
set -e
echo "🚀 Deploying Go HTTP server to Fly.io..."
flyctl config validate
flyctl deploy --remote-only
flyctl status
