#!/usr/bin/env bash
# ensemble-sync.sh — move the live Ensemble worktree forward to upstream, on our
# schedule, after we have looked at what changed.
#
# Since 2026-09-06 the `ensemble` marketplace in every Claude config root is a
# DIRECTORY source pointed at ~/projects/.worktrees/ensemble-live. That worktree
# is the single thing deciding what 56 sessions load. Nothing pulls from a remote
# marketplace, so nothing lands here without this script being run.
#
#   ensemble-sync.sh            report what upstream has that we do not, change nothing
#   ensemble-sync.sh --apply    fast-forward the worktree and update the plugin caches
#
# Refuses to apply when the fast-forward is not clean or the worktree is dirty.
# We take upstream verbatim or not at all; a merge conflict is a decision for a
# person, not something to resolve inside a sync job.

set -uo pipefail

LIVE_WORKTREE="${ENSEMBLE_LIVE_WORKTREE:-$HOME/projects/.worktrees/ensemble-live}"
DEV_CLONE="${ENSEMBLE_DEV_CLONE:-$HOME/projects/ensemble}"
UPSTREAM_REMOTE="${ENSEMBLE_UPSTREAM_REMOTE:-sunstone}"
UPSTREAM_BRANCH="${ENSEMBLE_UPSTREAM_BRANCH:-main}"
CONFIG_ROOTS=(
  "$HOME/.claude"
  "$HOME/.claude-fortiumsoftware"
  "$HOME/.claude-fortiumpartners"
)

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

die() { echo "✗ $*" >&2; exit 1; }

[ -e "$LIVE_WORKTREE/.git" ] || die "live worktree missing at $LIVE_WORKTREE"

git -C "$DEV_CLONE" fetch --quiet "$UPSTREAM_REMOTE" || die "could not fetch $UPSTREAM_REMOTE"

live_sha="$(git -C "$LIVE_WORKTREE" rev-parse HEAD)"
up_sha="$(git -C "$DEV_CLONE" rev-parse "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")"

if [ "$live_sha" = "$up_sha" ]; then
  echo "✓ Already current with ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} ($(git -C "$DEV_CLONE" rev-parse --short "$up_sha"))"
  exit 0
fi

behind="$(git -C "$DEV_CLONE" rev-list --count "${live_sha}..${up_sha}")"
ahead="$(git -C "$DEV_CLONE" rev-list --count "${up_sha}..${live_sha}")"

echo "Upstream:  ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} $(git -C "$DEV_CLONE" rev-parse --short "$up_sha")"
echo "Live:      $(git -C "$DEV_CLONE" rev-parse --short "$live_sha")  (${behind} behind, ${ahead} ahead)"
echo
echo "── New upstream commits ──"
git -C "$DEV_CLONE" log --oneline --no-merges "${live_sha}..${up_sha}" | head -40
echo
echo "── Command surface changes ──"
diff <(git -C "$DEV_CLONE" ls-tree -r --name-only "$live_sha" | grep -E '^packages/.*/commands/.*\.md$' | xargs -n1 basename 2>/dev/null | sed 's/\.md$//' | sort -u) \
     <(git -C "$DEV_CLONE" ls-tree -r --name-only "$up_sha"   | grep -E '^packages/.*/commands/.*\.md$' | xargs -n1 basename 2>/dev/null | sed 's/\.md$//' | sort -u) \
  | grep -E '^[<>]' | sed 's/^</  removed:/; s/^>/  added:  /' || echo "  (none)"

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "Nothing changed. Re-run with --apply to fast-forward and update the plugin caches."
  exit 0
fi

if [ "$ahead" -ne 0 ]; then
  die "live worktree has ${ahead} commit(s) upstream does not — refusing to fast-forward. Resolve by hand."
fi
[ -z "$(git -C "$LIVE_WORKTREE" status --porcelain)" ] \
  || die "live worktree is dirty — refusing to move it under 56 running sessions."

echo
echo "── Applying ──"
git -C "$LIVE_WORKTREE" merge --ff-only "$up_sha" || die "fast-forward failed"

# The marketplace manifest is what Claude Code reads. A broken one takes out
# every session's plugin, so check it before telling anyone to update.
jq -e '.name == "ensemble" and (.plugins | length) > 0' \
  "$LIVE_WORKTREE/.claude-plugin/marketplace.json" >/dev/null \
  || die "marketplace.json is invalid after sync — sessions would lose the plugin"

for p in $(jq -r '.plugins[].source' "$LIVE_WORKTREE/.claude-plugin/marketplace.json" | sed 's|^\./||'); do
  [ -f "$LIVE_WORKTREE/$p/.claude-plugin/plugin.json" ] \
    || die "marketplace lists $p but its plugin.json is missing"
done
echo "✓ marketplace.json valid ($(jq -r '.plugins|length' "$LIVE_WORKTREE/.claude-plugin/marketplace.json") plugins)"

for root in "${CONFIG_ROOTS[@]}"; do
  [ -d "$root" ] || continue
  echo "── $root"
  for plugin in $(jq -r '.plugins | keys[] | select(endswith("@ensemble"))' \
                    "$root/plugins/installed_plugins.json" 2>/dev/null | sed 's/@ensemble$//'); do
    CLAUDE_CONFIG_DIR="$root" claude plugin update "$plugin" 2>&1 | tail -1 | sed 's/^/    /'
  done
done

echo
echo "✓ Synced to $(git -C "$LIVE_WORKTREE" rev-parse --short HEAD)."
echo "  Running sessions keep their loaded plugin until they restart."
