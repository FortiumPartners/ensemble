#!/bin/bash
set -e
echo "🚀 Deploying Rails API to Fly.io..."
flyctl config validate
flyctl deploy --remote-only
flyctl status
