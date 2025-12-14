#!/bin/bash
#
# Post-GitHub-Rename Script
#
# Run this script AFTER renaming the GitHub repository from
# 'ai-mesh-plugins' to 'ensemble' in GitHub settings.
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

# Determine new remote URL
if [[ "$CURRENT_REMOTE" == *"ai-mesh-plugins"* ]]; then
    NEW_REMOTE=$(echo "$CURRENT_REMOTE" | sed 's/ai-mesh-plugins/ensemble/g')
    echo "New remote:     $NEW_REMOTE"
    echo ""

    # Update remote
    echo "Updating git remote..."
    git remote set-url origin "$NEW_REMOTE"
    echo "✓ Remote URL updated"
    echo ""

    # Verify remote is accessible
    echo "Verifying remote accessibility..."
    if git ls-remote --exit-code origin &>/dev/null; then
        echo "✓ Remote is accessible"
    else
        echo "✗ Warning: Remote not accessible yet"
        echo "  Make sure you've renamed the repository on GitHub first:"
        echo "  https://github.com/FortiumPartners/ai-mesh-plugins/settings"
        echo ""
        echo "  Reverting remote URL..."
        git remote set-url origin "$CURRENT_REMOTE"
        exit 1
    fi
else
    echo "Remote already updated or doesn't contain 'ai-mesh-plugins'"
fi

echo ""
echo "========================================"
echo "Next Steps"
echo "========================================"
echo ""
echo "1. Rename the local directory:"
echo ""
echo "   cd .."
echo "   mv ai-mesh-plugins ensemble"
echo "   cd ensemble"
echo ""
echo "2. Verify everything works:"
echo ""
echo "   git status"
echo "   git pull origin main"
echo ""
echo "3. (Optional) Clean up old config directories:"
echo ""
echo "   rm -rf ~/.ai-mesh-task-progress"
echo "   rm -rf ~/.ai-mesh-pane-viewer"
echo ""
echo "========================================"
echo "Done!"
echo "========================================"
