'use strict';

/**
 * Runner interface. A runner is `{ runtime, run(job, opts) }` where
 *   job = { evalId, skill, arm: 'with-skill'|'baseline', runtime, model, prompt, workspace, env, timeoutMs, maxUsd,
 *           pluginDirs[] | skillPaths[], maxTurns?, allowedTools?, permissionMode? }
 *   run(job) -> { transcript, exitCode, timedOut, costUsd, loadedSkills, runtime }  (plus optional extras)
 * `pluginDirs` is a list (Claude: one `--plugin-dir` each); `skillPaths` is for runtimes that load one skill.
 * The Pi adapter (a later PR) registers here.
 */

const claude = require('./claude');

const RUNNERS = { [claude.RUNTIME]: claude };

/** Runtimes this build can run. */
const supportedRuntimes = () => Object.keys(RUNNERS);

/** The runner for `runtime`; throws a named error for an unknown one. */
function getRunner(runtime) {
  const r = RUNNERS[runtime];
  if (!r) throw new Error(`unsupported runtime "${runtime}" (supported: ${supportedRuntimes().join(', ')})`);
  return r;
}

module.exports = { getRunner, supportedRuntimes, RUNNERS };
