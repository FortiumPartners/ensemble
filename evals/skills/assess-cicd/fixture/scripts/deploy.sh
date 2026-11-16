#!/bin/sh
# Deploy the current commit to the given environment.
set -eu
ENVIRONMENT="$1"
docker build -t "shipit:${GITHUB_SHA:-local}" .
docker push "shipit:${GITHUB_SHA:-local}"
ssh -i "$DEPLOY_KEY" "deploy@${ENVIRONMENT}.example.com" "docker pull shipit:${GITHUB_SHA:-local} && docker restart shipit"
