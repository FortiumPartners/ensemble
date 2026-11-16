'use strict';

/**
 * `<projectRoot>/.ensemble/state/` is the toolchain's own runtime state (preflight records,
 * ledger, failure records, traces, confirmations). Callers such as beads-build-wave Step 1.3
 * halt on any changed path in `workflow.status` outside `.beads/`, so in a repo whose
 * `.gitignore` has no `.ensemble/state/` entry a faithful run would halt on the toolchain's
 * own files. Every writer of that directory therefore calls `ensureStateDir`, which drops a
 * self-ignoring `.gitignore` (`*`, which also matches the file itself) at the state root,
 * so the state is invisible to `git status` in any repo without editing the repo's
 * tracked files, and without each caller having to know about it.
 */

const fs = require('fs');
const path = require('path');

/**
 * `mkdir -p` `dir` (which must be at or under `<projectRoot>/.ensemble/state`) and make the
 * state root ignore itself. Never overwrites an existing `.gitignore` and never throws for the
 * ignore file: state recording must not fail because the marker could not be written.
 *
 * @param {string} projectRoot
 * @param {string} dir directory to create
 */
function ensureStateDir(projectRoot, dir) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(projectRoot, '.ensemble', 'state', '.gitignore'), '*\n', { flag: 'wx' });
  } catch (error) {
    // EEXIST: already marked (or the repo/user owns the file). Anything else: best effort.
  }
}

module.exports = { ensureStateDir };
