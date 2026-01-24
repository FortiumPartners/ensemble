#!/bin/bash
set -e
echo "🚀 Deploying Flask + Redis to Fly.io..."
flyctl config validate
flyctl deploy --remote-only
flyctl status
