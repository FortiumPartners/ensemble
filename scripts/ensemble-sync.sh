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
#
# Otherwise the roots are DISCOVERED, not listed. A hardcoded list was wrong the
# moment a fourth and fifth account appeared: this script named three roots while
# provision-ensemble.sh named five, so `--apply` reported a full success having
# never touched .claude-gmail or .claude-autreymail. A list that has to be edited
# every time an account is added will be out of date again by the next account.
# `settings.json` is the same test provision-ensemble.sh already uses to tell a
# config root from session storage like .claude-sessions.
# A directory under $HOME that merely has a settings.json is not necessarily a
# live config root. `cp -r ~/.claude ~/.claude-backup-preupgrade` is the ordinary
# thing to do before an upgrade, and the copy is indistinguishable from the
# original by content — so a name that reads as a backup is skipped, out loud, and
# every root that IS adopted is printed before anything is written to it. Silent
# adoption was the objection; being told is the fix.
looks_like_backup() {
  case "$(basename "$1")" in
    *-backup*|*.backup*|*-copy*|*.copy*|*.bak|*-bak|*.old|*-old|*.orig|*-orig|*-save|*.save) return 0 ;;
    *) return 1 ;;
  esac
}
discover_config_roots() {
  local d found=0
  for d in "$HOME"/.claude "$HOME"/.claude-*; do
    [ -d "$d" ] && [ -f "$d/settings.json" ] || continue
    if looks_like_backup "$d"; then
      echo "  skipping $(basename "$d") — reads as a backup copy; set" >&2
      echo "  ENSEMBLE_CONFIG_ROOTS to include it anyway" >&2
      continue
    fi
    printf '%s\n' "$d"
    found=1
  done
  [ "$found" -eq 1 ]
}

if [ -n "${ENSEMBLE_CONFIG_ROOTS+x}" ]; then
  read -r -a CONFIG_ROOTS <<< "$ENSEMBLE_CONFIG_ROOTS"
else
  CONFIG_ROOTS=()
  while IFS= read -r r; do CONFIG_ROOTS+=("$r"); done < <(discover_config_roots)
  # Discovering nothing is not the same as an explicit empty override. Refusing
  # here is the point: a refresh loop over zero roots reports success having
  # verified nothing, which is the exact defect this script exists to catch.
  [ ${#CONFIG_ROOTS[@]} -gt 0 ] \
    || { echo "✗ no Claude config root found under $HOME (looked for .claude*/settings.json)" >&2; exit 1; }
  echo "Config roots (${#CONFIG_ROOTS[@]}): $(printf '%s ' "${CONFIG_ROOTS[@]##*/}")" >&2
fi

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

die() { echo "✗ $*" >&2; exit 1; }

[ -e "$LIVE_WORKTREE/.git" ] || die "live worktree missing at $LIVE_WORKTREE"

git -C "$DEV_CLONE" fetch --quiet "$UPSTREAM_REMOTE" || die "could not fetch $UPSTREAM_REMOTE"

# Unguarded, an unresolvable ref leaves the variable empty and `${live_sha}..`
# is git shorthand for `${live_sha}..HEAD`, which counts 0 and exits 0. The script
# would then report "already current" on a misconfigured upstream.
live_sha="$(git -C "$LIVE_WORKTREE" rev-parse HEAD)" \
  || die "could not resolve HEAD in $LIVE_WORKTREE"
up_sha="$(git -C "$DEV_CLONE" rev-parse "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")" \
  || die "could not resolve ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} in $DEV_CLONE"
[ -n "$live_sha" ] && [ -n "$up_sha" ] || die "empty sha resolving live or upstream ref"

# Reinstall every registered @ensemble plugin in each config root and verify by
# CONTENT that the cache now matches source. Callable on its own, because a
# worktree already at upstream can still be serving sessions a stale cache.
refresh_caches() {
  refresh_failures=0

  for root in ${CONFIG_ROOTS[@]+"${CONFIG_ROOTS[@]}"}; do
    [ -d "$root" ] || continue
    echo "── $root"

    # Read the plugin list with the jq failure VISIBLE. Swallowing it meant a root
    # with a missing or malformed installed_plugins.json iterated zero plugins,
    # left refresh_failures at 0, and was reported as fully refreshed having
    # checked nothing — the same defect this function was written to fix.
    if ! plugin_list="$(jq -r '.plugins | keys[] | select(endswith("@ensemble"))' \
                          "$root/plugins/installed_plugins.json" 2>&1)"; then
      echo "    ✗ cannot read $root/plugins/installed_plugins.json — nothing verified here"
      printf '%s\n' "$plugin_list" | sed 's/^/        /'
      refresh_failures=$((refresh_failures + 1))
      continue
    fi
    if [ -z "$plugin_list" ]; then
      echo "    ✗ no @ensemble plugin registered — this root loads no Ensemble at all"
      echo "        run scripts/provision-ensemble.sh to install it"
      refresh_failures=$((refresh_failures + 1))
      continue
    fi

    for plugin in $(printf '%s\n' "$plugin_list" | sed 's/@ensemble$//'); do
      CLAUDE_CONFIG_DIR="$root" claude plugin uninstall "$plugin" >/dev/null 2>&1
      # Keep stderr. Discarding it left "reinstall FAILED" with no reason, which
      # is the failure mode (nothing says why) that motivated this whole script.
      if ! cli_out="$(CLAUDE_CONFIG_DIR="$root" claude plugin install "${plugin}@ensemble" 2>&1)"; then
        echo "    ✗ ${plugin}: reinstall FAILED"
        printf '%s\n' "$cli_out" | tail -5 | sed 's/^/        /'
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

      # Compare by CONTENT MANIFEST, not with `diff -rq`.
      #
      # diff could not do this job here and said so, and the first version of this
      # check counted its complaints as drift. packages/full/skills is 52 symlinks
      # into the other packages, and diff emits 20 `Directory loop detected` errors
      # on the source side; with 2>&1 those errors landed in the same stream as the
      # findings, so a byte-identical cache reported 20 drifts and --apply would have
      # died at this gate every single time. Worse than the false alarm: those 20
      # skill directories were never compared at all, so the gate also measured less
      # than it claimed.
      #
      # A manifest of path+hash sidesteps the traversal entirely. `find -L` follows
      # the symlinks the installer dereferences on copy and handles the cycle
      # cleanly (227 files, exit 0, no errors, against diff's 20 refusals).
      manifest() {
        ( cd "$1" 2>/dev/null || exit 1
          # shellcheck disable=SC2086  # $2 is a fixed flag, deliberately unquoted
          find $2 . -type f -print0 2>/dev/null | LC_ALL=C sort -z \
            | xargs -0 -n 64 shasum 2>/dev/null ) | LC_ALL=C sort
      }
      src_manifest="$(manifest "$LIVE_WORKTREE/$src_rel" -L)"
      dst_manifest="$(manifest "$install_path" "")"

      # An empty manifest means the comparison measured nothing, which must never
      # read as agreement — that is the defect this whole script is about.
      if [ -z "$src_manifest" ]; then
        echo "    ✗ ${plugin}: source manifest is empty — cannot verify the copy"
        refresh_failures=$((refresh_failures + 1))
        continue
      fi

      # Lines present in source but not in the cache: a file that never copied, or
      # one whose content differs. Lines only in the cache are stale leftovers the
      # installer does not remove, and are genuinely harmless, so they are dropped
      # by direction rather than by pattern.
      drift="$(comm -23 <(printf '%s\n' "$src_manifest") <(printf '%s\n' "$dst_manifest") | head -3)"
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
    echo "✗ ${refresh_failures} plugin refresh(es) did not land — sessions would keep the old content." >&2
    return 1
  fi
  return 0
}


if [ "$live_sha" = "$up_sha" ]; then
  echo "✓ Already current with ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} ($(git -C "$DEV_CLONE" rev-parse --short "$up_sha"))"
  # The worktree matching upstream says nothing about the plugin caches: a manual
  # fast-forward, or an earlier run that moved the tree and failed at the refresh,
  # both leave sessions on old content with nothing here able to fix it. --apply
  # still refreshes, because the caches are the thing sessions actually load.
  if [ "$APPLY" -eq 0 ]; then
    echo "  Re-run with --apply to refresh the plugin caches against it."
    exit 0
  fi
  echo
  echo "── Refreshing plugin caches only ──"
  refresh_caches
  exit $?
fi

behind="$(git -C "$DEV_CLONE" rev-list --count "${live_sha}..${up_sha}")"
merge_base="$(git -C "$DEV_CLONE" merge-base "$live_sha" "$up_sha" 2>/dev/null)"
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
    # The abort is what makes the claim at the bottom of this block true. Swallowing
    # its status let the script tell 56 sessions the worktree was untouched while it
    # sat mid-rebase with conflict markers in the files they load.
    if ! abort_out="$(git -C "$LIVE_WORKTREE" rebase --abort 2>&1)"; then
      echo "$abort_out" | sed 's/^/    /' >&2
      die "rebase conflicted AND the rebase --abort failed — $LIVE_WORKTREE is mid-rebase
  right now and every config root's plugin cache is pinned to it. Fix it by hand
  before any session restarts:  git -C \"$LIVE_WORKTREE\" status"
    fi

    # Before handing this to a person, work out WHY. The common cause is not a real
    # divergence: GitHub squash-merges a PR, so our three commits arrive upstream as
    # one with a new patch-id, `--no-reapply-cherry-picks` cannot match them, and the
    # replay conflicts with our own already-landed work. Measured 2026-09-07 on
    # Sunstone-Partners/ensemble#65.
    #
    # The test that survives a squash is content, not commit identity: does upstream
    # already contain every line our patches added?
    absorbed=1
    touched="$(git -C "$DEV_CLONE" diff --name-only "${merge_base}..${live_sha}" 2>/dev/null)"
    for f in $touched; do
      # Lines we have that upstream lacks. Zero for every file means fully absorbed.
      missing="$(git -C "$DEV_CLONE" diff --numstat "${live_sha}" "${up_sha}" -- "$f" 2>/dev/null | awk '{print $2}')"
      [ -z "$missing" ] && missing=0
      if [ "$missing" -ne 0 ] 2>/dev/null; then absorbed=0; fi
    done

    echo
    if [ "$absorbed" -eq 1 ] && [ -n "$touched" ]; then
      echo "  Diagnosis: upstream already contains every line these patches add."
      echo "  That is what a squash-merge looks like from here — same content, new"
      echo "  commit, so patch-id cannot match and the replay fights our own work."
      echo
      echo "  Files checked, all fully absorbed:"
      printf '%s\n' $touched | sed 's/^/      /'
      echo
      echo "  If you agree these landed upstream, drop them and take upstream as-is:"
      live_branch="$(git -C "$LIVE_WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null)"
      if [ -n "$live_branch" ] && [ "$live_branch" != "HEAD" ]; then
        # Not `reset --hard`: detach, move the ref, re-attach. Same result, and it
        # keeps this script clear of the destructive-op family entirely.
        echo "      git -C \"$LIVE_WORKTREE\" checkout --detach ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
        echo "      git -C \"$DEV_CLONE\" branch -f ${live_branch} ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
        echo "      git -C \"$LIVE_WORKTREE\" checkout ${live_branch}"
      else
        echo "      git -C \"$LIVE_WORKTREE\" checkout --detach ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
      fi
      echo "      then re-run this script with --apply to refresh the plugin caches."
    else
      echo "  Diagnosis: upstream does NOT contain all of our changes, so this is a"
      echo "  real divergence rather than a squash-merge. Resolve the conflict by hand."
    fi
    die "rebase conflicted — the worktree is untouched."
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

refresh_caches || die "plugin refresh failed — sessions would keep the old content."

echo
echo "✓ Synced to $(git -C "$LIVE_WORKTREE" rev-parse --short HEAD)."
echo "  Running sessions keep their loaded plugin until they restart."
