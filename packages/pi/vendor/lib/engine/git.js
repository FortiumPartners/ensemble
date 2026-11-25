'use strict';

/**
 * TRD-008 (TRD-2026-d571763f): the one place the engine runs `git` itself.
 *
 * Everything the engine can ask a toolchain adapter it asks through `cli-json.js`, so this module
 * exists for the single question no `workflow` capability answers: which files git itself tracks
 * (`skills/staleness-gate/SKILL.md:103`). The staleness gate is defined in terms of
 * `git ls-files --exclude-standard` -- the file set git considers tracked after `.gitignore` and
 * every other exclude file -- and reproducing that set from a status listing would be a second,
 * divergent implementation of git's own exclude rules.
 *
 * A missing `git` is `UNAVAILABLE`, never an empty file list: a drift check that sees no files
 * would report "no drift" and pass, which is a check that cannot fail (Constitution Rule 7).
 */

const { execFileSync } = require('child_process');

const { unavailable } = require('./result');
const { MAX_OUTPUT_BYTES } = require('./cli-json');

/**
 * Run `git` in the project root and return its stdout.
 * @param {object} call the dispatcher's call object
 * @param {string[]} args git's own arguments
 * @returns {string|object} stdout, or a tagged engine result when git could not be run
 */
function git(call, args) {
  try {
    return execFileSync('git', args, {
      cwd: call.projectRoot,
      encoding: 'utf8',
      env: call.env,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (err) {
    return unavailable(
      'GIT_UNAVAILABLE',
      `git ${args.join(' ')} failed: ${err && err.message ? err.message : String(err)}`
    );
  }
}

/**
 * The files git tracks, after every exclude file it honours.
 * @param {object} call the dispatcher's call object
 * @returns {string[]|object} project-relative paths, or a tagged engine result
 */
function lsFiles(call) {
  const out = git(call, ['ls-files', '--exclude-standard', '-z']);
  if (typeof out !== 'string') return out;
  // `-z` separates paths with NUL, so a name holding a newline or a tab survives intact.
  return out.split('\0').filter(line => line.length > 0);
}

/**
 * The branch `HEAD` is on.
 * @param {object} call the dispatcher's call object
 * @returns {string|object} the branch name, `''` on a detached HEAD, or a tagged engine result
 */
function currentBranch(call) {
  const out = git(call, ['branch', '--show-current']);
  if (typeof out !== 'string') return out;
  return out.trim();
}

/**
 * Every branch this repository has locally.
 * @param {object} call the dispatcher's call object
 * @returns {string[]|object} branch names, or a tagged engine result
 */
function localBranches(call) {
  // `lstrip=2` drops the `refs/heads/` prefix, so the name is the branch name itself.
  const out = git(call, ['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads']);
  if (typeof out !== 'string') return out;
  return out.split('\n').map(line => line.trim()).filter(line => line.length > 0);
}

/**
 * The remote's default branch, which a new branch is cut from
 * (`skills/implement-trd-tasks-reference/SKILL.md:29`). A repository with no `origin/HEAD` -- a
 * fresh clone-less fixture, or a remote that never published one -- answers `main`, the fallback
 * the reference names, rather than an error: the base is an input to a branch the maintainer is
 * about to create, not a gate.
 * @param {object} call the dispatcher's call object
 * @returns {string} the branch name without its `origin/` prefix
 */
function remoteDefaultBranch(call) {
  // `--quiet` because "this repository has no origin/HEAD" is an ordinary answer here, not a
  // failure worth printing: the fallback below is what the reference prescribes for it.
  const out = git(call, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (typeof out !== 'string') return 'main';
  const name = out.trim().replace(/^origin\//, '');
  return name.length > 0 ? name : 'main';
}

/**
 * Switch to an existing branch. The name is checked with git's own `check-ref-format` first, so
 * a name the engine would otherwise hand to `git switch` cannot be read as an option or as
 * anything but a branch.
 * @param {object} call the dispatcher's call object
 * @param {string} name the branch to switch to
 * @returns {string|object} git's stdout, or a tagged engine result
 */
function switchTo(call, name) {
  const checked = git(call, ['check-ref-format', '--branch', name]);
  if (typeof checked !== 'string') return checked;
  return git(call, ['switch', name]);
}

module.exports = { currentBranch, git, localBranches, lsFiles, remoteDefaultBranch, switchTo };
