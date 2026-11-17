#!/bin/sh
# Creates the commit history since the v1.0.0 release (conventional commits). Run once from the repository root:  sh tools/seed-history.sh
set -e
git tag v1.0.0
c() { # c <message>: commit an empty change with that message
  git commit -q --allow-empty -m "$1"
}
c "feat(api): add rate limiting with Redis backend"
c "feat(ui): implement dark mode toggle"
c "fix(database): fix connection pool exhaustion"
c "perf(api): add query indexes for widget lookups"
c "docs: document the setup steps in the README"
c "refactor(auth)!: remove deprecated OAuth 1.0 support"
c "fix(config): rename the timeout option

BREAKING CHANGE: the timeout option is now called timeoutMs"
c "chore: bump lodash to 4.17.21"
echo "history seeded: v1.0.0..HEAD has 8 commits"
