#!/bin/bash
set -e
echo "🚀 Deploying Phoenix LiveView to Fly.io..."
flyctl config validate
flyctl deploy --remote-only
flyctl status
