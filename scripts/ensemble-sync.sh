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
# Space-separated override exists so the apply path can be exercised end to end
# without repointing 56 sessions' plugin caches. Empty means "skip that step".
if [ -n "${ENSEMBLE_CONFIG_ROOTS+x}" ]; then
  read -r -a CONFIG_ROOTS <<< "$ENSEMBLE_CONFIG_ROOTS"
else
  CONFIG_ROOTS=(
    "$HOME/.claude"
    "$HOME/.claude-fortiumsoftware"
    "$HOME/.claude-fortiumpartners"
  )
fi

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
  echo "Nothing changed. Re-run with --apply to move the worktree and update the plugin caches."
  exit 0
fi

[ -z "$(git -C "$LIVE_WORKTREE" status --porcelain)" ] \
  || die "live worktree is dirty — refusing to move it under 56 running sessions."

echo
echo "── Applying ──"

if [ "$ahead" -eq 0 ]; then
  git -C "$LIVE_WORKTREE" merge --ff-only "$up_sha" || die "fast-forward failed"
else
  # We carry local patches — reviewed fixes sent upstream but not yet merged there.
  # Rebase them onto upstream rather than refusing: refusing was correct when we
  # carried nothing, and becomes a permanent block the moment we carry anything.
  #
  # A conflict is a person's decision, not a sync job's. Abort and say so, leaving
  # the worktree exactly where it was so sessions keep loading a known-good tree.
  echo "Replaying ${ahead} local patch(es) onto ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}:"
  git -C "$DEV_CLONE" log --oneline "${up_sha}..${live_sha}" | sed 's/^/    /'

  before_list="$(git -C "$DEV_CLONE" log --format=%s "${up_sha}..${live_sha}")"

  # Rebase ONTO upstream with upstream as the comparison base, not `--onto <new>
  # <merge-base>`. The latter replays correctly but scans only as far as the merge
  # base for duplicates, so when upstream takes a patch by cherry-pick — same
  # content, new SHA — it is not recognised and the replay conflicts with itself.
  # Comparing against upstream lets git match by patch-id and drop what has landed.
  if ! git -C "$LIVE_WORKTREE" rebase --no-reapply-cherry-picks "$up_sha" 2>&1 | sed 's/^/    /'; then
    git -C "$LIVE_WORKTREE" rebase --abort 2>/dev/null || true
    die "rebase conflicted — the worktree is untouched. Resolve by hand, then re-run."
  fi

  after_list="$(git -C "$LIVE_WORKTREE" log --format=%s "${up_sha}..HEAD")"
  after_count="$(git -C "$LIVE_WORKTREE" rev-list --count "${up_sha}..HEAD")"

  # A patch that vanished in the rebase is one upstream has now taken. Say which,
  # because a patch nobody notices has landed is one we keep carrying forever.
  if [ "$after_count" -lt "$ahead" ]; then
    echo
    echo "  ✓ Upstream has taken $((ahead - after_count)) of our patches:"
    while IFS= read -r subject; do
      [ -z "$subject" ] && continue
      printf '%s\n' "$after_list" | grep -qxF "$subject" || echo "      $subject"
    done <<< "$before_list"
    echo "    Nothing to do — they are in upstream now and no longer carried."
  fi
  if [ "$after_count" -gt 0 ]; then
    echo
    echo "  Still carrying ${after_count} patch(es) not yet upstream:"
    git -C "$LIVE_WORKTREE" log --oneline "${up_sha}..HEAD" | sed 's/^/      /'
  fi
fi

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

# `claude plugin update` is VERSION-gated: when the marketplace content changes but
# plugin.json's version does not — which is exactly what carrying a local patch
# does — it prints "already at the latest version" and copies nothing. Measured on
# 2026-09-06: the cache still held the unpatched file afterwards while the command
# reported success. Uninstall+install is the only refresh that actually re-copies.
refresh_failures=0

for root in ${CONFIG_ROOTS[@]+"${CONFIG_ROOTS[@]}"}; do
  [ -d "$root" ] || continue
  echo "── $root"
  for plugin in $(jq -r '.plugins | keys[] | select(endswith("@ensemble"))' \
                    "$root/plugins/installed_plugins.json" 2>/dev/null | sed 's/@ensemble$//'); do
    CLAUDE_CONFIG_DIR="$root" claude plugin uninstall "$plugin" >/dev/null 2>&1
    if ! CLAUDE_CONFIG_DIR="$root" claude plugin install "${plugin}@ensemble" >/dev/null 2>&1; then
      echo "    ✗ ${plugin}: reinstall FAILED"
      refresh_failures=$((refresh_failures + 1))
      continue
    fi

    # Verify by CONTENT, not by exit status and not by mtime. The command reports
    # success on a version-gated no-op, and `claude plugin install` preserves mtimes
    # when it re-copies identical content, so neither says whether the cache matches
    # source. Comparing the files answers it directly.
    install_path="$(jq -r --arg k "${plugin}@ensemble" \
      '.plugins[$k][]? | select(.scope=="user") | .installPath' \
      "$root/plugins/installed_plugins.json" 2>/dev/null | head -1)"
    if [ -z "$install_path" ] || [ ! -d "$install_path" ]; then
      echo "    ✗ ${plugin}: no install path after reinstall"
      refresh_failures=$((refresh_failures + 1))
      continue
    fi

    src_rel="$(jq -r --arg n "$plugin" \
      '.plugins[] | select(.name == $n) | .source' \
      "$LIVE_WORKTREE/.claude-plugin/marketplace.json" 2>/dev/null | sed 's|^\./||')"
    if [ -z "$src_rel" ] || [ ! -d "$LIVE_WORKTREE/$src_rel" ]; then
      echo "    ✗ ${plugin}: marketplace names no source dir — cannot verify the copy"
      refresh_failures=$((refresh_failures + 1))
      continue
    fi

    # "Only in" lines are stale files the installer leaves behind on re-copy; they are
    # harmless. A file present in both that DIFFERS means the cache did not take.
    drift="$(diff -rq "$LIVE_WORKTREE/$src_rel" "$install_path" 2>/dev/null \
             | grep -v '^Only in' | head -3)"
    if [ -n "$drift" ]; then
      echo "    ✗ ${plugin}: cache does not match source after reinstall"
      printf '%s\n' "$drift" | sed 's/^/        /'
      refresh_failures=$((refresh_failures + 1))
      continue
    fi
    printf '    ✓ %s\n' "$plugin"
  done
done

if [ "$refresh_failures" -ne 0 ]; then
  die "${refresh_failures} plugin refresh(es) did not land — sessions would keep the old content."
fi

echo
echo "✓ Synced to $(git -C "$LIVE_WORKTREE" rev-parse --short HEAD)."
echo "  Running sessions keep their loaded plugin until they restart."
