#!/bin/bash
#
# Post-GitHub-Rename Script
#
# NOTE: This script was used during the migration from 'ai-mesh-plugins' to 'ensemble'.
# The migration is now complete. This script is kept for historical reference.
#
# This script:
# 1. Updates the git remote URL to the new repository name
# 2. Verifies the remote is accessible
# 3. Provides instructions for renaming the local directory
#
# Usage: ./scripts/post-github-rename.sh
#

set -e

echo "========================================"
echo "Post-GitHub-Rename Setup"
echo "========================================"
echo ""

# Check current remote
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")

if [ -z "$CURRENT_REMOTE" ]; then
    echo "Error: No git remote 'origin' found"
    exit 1
fi

echo "Current remote: $CURRENT_REMOTE"

# Check if remote needs updating (migration already complete)
if [[ "$CURRENT_REMOTE" == *"ensemble"* ]]; then
    echo "✓ Remote already points to 'ensemble' repository"

    # Verify remote is accessible
    echo "Verifying remote accessibility..."
    if git ls-remote --exit-code origin &>/dev/null; then
        echo "✓ Remote is accessible"
    else
        echo "✗ Warning: Remote not accessible"
        exit 1
    fi
else
    echo "Warning: Remote URL doesn't contain 'ensemble'"
    echo "Expected: https://github.com/FortiumPartners/ensemble"
    echo "Current:  $CURRENT_REMOTE"
fi

echo ""
echo "========================================"
echo "Migration Status"
echo "========================================"
echo ""
echo "✓ GitHub repository renamed to 'ensemble'"
echo "✓ Local directory renamed to 'ensemble'"
echo ""
echo "Verify everything works:"
echo ""
echo "   git status"
echo "   git pull origin main"
echo ""
echo "(Optional) Clean up old config directories if they exist:"
echo ""
echo "   rm -rf ~/.ai-mesh-task-progress"
echo "   rm -rf ~/.ai-mesh-pane-viewer"
echo ""
echo "========================================"
echo "Done!"
echo "========================================"
