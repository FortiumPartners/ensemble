'use strict';

/**
 * TRD-007 (TRD-2026-d571763f): the working-tree state the dirty-tree gate reads.
 *
 * The state comes from `workflow.status`, the toolchain capability the skill already uses
 * (`skills/implement-trd-tasks-reference/SKILL.md:17`), so a repository whose `workflow` adapter
 * is not plain git is read through its own adapter rather than through a hardcoded
 * `git status --porcelain`.
 *
 * Tracker-owned `.beads/` paths are not dirt: the tracker rewrites its export during an ordinary
 * run (`docs/guides/beads-tracked-export.md`), and counting that as a dirty tree would refuse
 * every build that followed a tracker sync. Nothing else is filtered -- the gate exists to stop
 * a build on top of uncommitted work.
 *
 * An unreadable status is `UNAVAILABLE`, never "clean": a gate that passes when it cannot see the
 * tree is a check that cannot fail (Constitution Rule 7).
 */

const { runToolchain, toolchainFailure } = require('./cli-json');
const { unavailable } = require('./result');

/** The tracker-owned directory whose churn is expected during a run. */
const TRACKER_DIR = '.beads';

/**
 * The paths a porcelain line names. `XY path` for an ordinary entry; `XY old -> new` for a
 * rename, where BOTH sides matter -- a rename out of `.beads/` into the tree is dirt.
 * @param {string} line a `git status --porcelain` line
 * @returns {string[]}
 */
function pathsOfLine(line) {
  const status = line.slice(0, 2);
  const body = line.slice(3);
  // Only a rename or a copy carries the ` -> ` separator; an ordinary entry's name may hold
  // ` -> ` itself, and splitting it there would name a path that does not exist.
  const parts = status.includes('R') || status.includes('C') ? splitRenamePaths(body) : [body];
  return parts.map(part => part.trim().replace(/^"(.*)"$/, '$1')).filter(part => part.length > 0);
}

/**
 * Split a porcelain rename field on ` -> `, honouring git's quoting: a ` -> ` inside a quoted
 * name is part of that name, not the separator.
 * @param {string} body the field after the status
 * @returns {string[]}
 */
function splitRenamePaths(body) {
  const parts = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quoted && char === '\\') {
      current += char + (body[index + 1] === undefined ? '' : body[index + 1]);
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted && body.startsWith(' -> ', index)) {
      parts.push(current);
      current = '';
      index += 3;
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** True when every path the line names belongs to the tracker's own export. */
function isTrackerOwned(line) {
  const paths = pathsOfLine(line);
  if (paths.length === 0) return false;
  return paths.every(entry => entry === TRACKER_DIR || entry.startsWith(`${TRACKER_DIR}/`));
}

/**
 * Read the working tree through the project's `workflow` adapter.
 * @param {object} call the dispatcher's call object
 * @returns {{dirty: boolean, files: string[]}|object} the status, or a tagged engine result when
 *   the status could not be read
 */
function readWorktree(call) {
  const result = runToolchain(call, ['run', 'workflow.status']);
  if (!result.json) {
    return unavailable(
      'WORKTREE_STATUS_UNREADABLE',
      `workflow.status produced no JSON result (exit ${result.exitCode})${
        result.stderr ? `: ${result.stderr.trim()}` : ''
      }`
    );
  }
  if (result.json.ok !== true) return toolchainFailure(result.json.error);
  const files = result.json.data && result.json.data.files;
  if (!Array.isArray(files)) {
    return unavailable(
      'WORKTREE_STATUS_UNREADABLE',
      "workflow.status returned no 'files' array, so the working tree cannot be judged clean or dirty"
    );
  }
  const kept = files
    .map(line => String(line))
    .filter(line => !isTrackerOwned(line))
    .map(line => pathsOfLine(line).join(' -> '));
  return { dirty: kept.length > 0, files: kept };
}

module.exports = { TRACKER_DIR, readWorktree };
