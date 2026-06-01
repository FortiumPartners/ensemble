---
name: staleness-gate
description: 'Detect whether a TRD is stale before implementation begins. If stale, invoke'
---
# TRD Staleness Gate

Detect whether a TRD is stale before implementation begins. If stale, invoke
`/ensemble:refine-trd` to refresh it, then proceed. If refinement fails, halt.

---

## Inputs

| Variable    | Type    | Description |
|-------------|---------|-------------|
| `TRD_PATH`  | string  | Absolute or repo-relative path to the TRD `.md` file |
| `IS_RESUME` | boolean | `true` when implementation is resuming an existing scaffold; `false` on first invocation |
| `FLAVOR`    | string  | Calling command name (for diagnostic messages): `implement-trd-beads`, `implement-trd`, or `beads-build` |

---

## Resume Detection by Flavor

| Flavor | `IS_RESUME = true` when |
|--------|------------------------|
| `implement-trd-beads` | `ROOT_EPIC_ID` found in `br list --json` for this TRD slug (Preflight step 6 — Resume Detection) |
| `implement-trd` | `git branch --list feature/<TRD_SLUG>-sprint-1` returns a branch name (checked before branch creation) |
| `beads-build --trd` | `ROOT_EPIC_ID` found in Epic Discovery step (Preflight step 4) |

---

## Algorithm

### Step 1 — Resume Check

```
IF IS_RESUME == true:
    print "Staleness check: skipped (resume detected)"
    RETURN
```

Staleness detection does not apply to resuming an existing scaffold. The TRD was
already validated on first invocation; checking it again mid-session would block
legitimate resume operations.

---

### Step 2 — Get TRD mtime

Determine the last-modified time of the TRD file as a Unix epoch integer.

```bash
# macOS
TRD_MTIME=$(stat -f %m "<TRD_PATH>")

# Linux
TRD_MTIME=$(stat -c %Y "<TRD_PATH>")

# Fallback (cross-platform, if stat not available or fails)
TRD_MTIME=$(python3 -c "import os; print(int(os.path.getmtime('<TRD_PATH>')))")
```

Try macOS form first; if it fails (non-zero exit or empty output), try Linux form;
if that fails, try the Python fallback.

```
IF all three methods fail:
    print "WARNING: Cannot determine TRD file age — skipping staleness check."
    RETURN
```

---

### Step 3 — Age Check

```bash
CURRENT_TIME=$(date +%s)
AGE_SECONDS=$(( CURRENT_TIME - TRD_MTIME ))
AGE_HOURS=$(( AGE_SECONDS / 3600 ))
```

```
IF AGE_HOURS > 24:
    STALE_AGE=true
ELSE:
    STALE_AGE=false
```

The threshold is 24 hours. A TRD created more than 24 hours ago may no longer
accurately reflect the current state of the codebase.

---

### Step 4 — Source File Drift Check

**This step ALWAYS runs, even if `STALE_AGE=true`.** Both conditions are evaluated
independently so the staleness message can report both age and drift when both apply.

List all tracked source files (respecting `.gitignore`) and exclude generated
artifacts that do not constitute meaningful code drift:

```bash
git ls-files --exclude-standard \
  | grep -vE "^packages/[^/]+/commands/ensemble/|^packages/pi/prompts/|^packages/codex/\.codex/"
```

**Exclusion rationale:**

| Excluded pattern | Reason |
|-----------------|--------|
| `packages/*/commands/ensemble/` | Generated markdown command files — updated by `npm run generate` after YAML edits; not meaningful drift |
| `packages/pi/prompts/` | Generated pi prompt files |
| `packages/codex/.codex/` | Generated codex skill files |
| Any path in `.gitignore` | Covered by `--exclude-standard`: `dist/`, `build/`, `node_modules/`, `coverage/`, `.beads.bd/`, `.bv/`, `.ntm/`, `.opencode/`, `.dolt/` |

For each file in the filtered list, retrieve its mtime (same platform-aware stat
as Step 2). Collect all files where `file_mtime > TRD_MTIME`:

```
NEWER_FILES = [ file for file in filtered_list if mtime(file) > TRD_MTIME ]
NEWER_COUNT = len(NEWER_FILES)

IF NEWER_COUNT > 0:
    STALE_DRIFT=true
ELSE:
    STALE_DRIFT=false
```

---

### Step 5 — Gate Decision

```
STALE = (STALE_AGE OR STALE_DRIFT)
```

**If not stale:**

```
print "Staleness check: TRD is current"
RETURN
```

**If stale:** build a combined diagnostic message and invoke refinement.

Message construction:

```
MESSAGE = ""

IF STALE_AGE:
    MESSAGE += "TRD is ${AGE_HOURS}h old (threshold: 24h).\n"

IF STALE_DRIFT:
    MESSAGE += "${NEWER_COUNT} source file(s) are newer than the TRD:\n"
    FOR file IN NEWER_FILES[0:10]:
        MESSAGE += "  - ${file}\n"
    IF NEWER_COUNT > 10:
        MESSAGE += "  (and ${NEWER_COUNT - 10} more)\n"

MESSAGE += "Running /ensemble:refine-trd before implementation."
```

Print the message, then invoke:

```
/ensemble:refine-trd <TRD_PATH>
```

---

### Step 6 — Post-Refinement Decision

```
IF refine-trd exits 0:
    print "Staleness gate satisfied — TRD refreshed. Proceeding with implementation."
    RETURN
    # No re-check: the refinement is trusted. A second staleness check would create
    # an infinite loop if the refine-trd command itself touches source files.

IF refine-trd exits non-zero:
    print "STALENESS GATE FAILURE: TRD refinement failed. Fix the TRD manually and re-run."
    HALT
```

**RETURN** means: resume execution at the next Preflight step in the calling command.  
**HALT** means: do not proceed with any implementation. The calling command stops.

---

## Known Limitation

**Git clone/checkout resets file mtimes.**

After `git clone`, `git checkout`, or `git pull`, all files receive the current
wall-clock time as their mtime. This means:

- A freshly-cloned repository will show all files as "newer than" the TRD — even
  if no actual changes were made relative to the TRD's last update.
- Checking out an old branch on a recent working tree will not reliably detect
  semantic staleness introduced by the branch switch.

This limitation is accepted and documented in PRD-2026-022 non-goals. Semantic
staleness detection (git log-based, content-aware) is out of scope for this release.

**Workaround:** If you encounter false-positive staleness after a fresh clone,
either run `/ensemble:refine-trd` manually (it will confirm the TRD is current and
re-touch its mtime), or proceed past the gate — the refinement step is designed to
be safe to run even when the TRD is already accurate.
