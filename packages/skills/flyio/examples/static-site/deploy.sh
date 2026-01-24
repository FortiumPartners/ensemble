#!/bin/bash
set -e
echo "🚀 Deploying static site to Fly.io..."
flyctl config validate
flyctl deploy --remote-only
flyctl status
