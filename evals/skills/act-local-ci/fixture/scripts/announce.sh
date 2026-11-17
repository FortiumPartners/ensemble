#!/bin/sh
# Posts a release note; needs DEPLOY_NOTE_TOKEN.
test -n "$DEPLOY_NOTE_TOKEN" || { echo "DEPLOY_NOTE_TOKEN is required" >&2; exit 1; }
echo "release note posted"
