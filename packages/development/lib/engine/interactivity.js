'use strict';

/**
 * TRD-006 (TRD-2026-d571763f): who is asking -- a person at a terminal, or Foreman.
 *
 * The skill decides this by whether `AskUserQuestion` is available to it. The engine is a CLI and
 * cannot see that tool, so interactive is the default and a caller that cannot answer a question
 * says so explicitly: the global `--non-interactive`, the `--foreman` flag, or a non-empty
 * `FOREMAN_TASK_TITLE` in the environment.
 *
 * `CI` and `ENSEMBLE_NON_INTERACTIVE` deliberately do not imply it
 * (`skills/ensemble-implement-trd-tasks/SKILL.md:37` says so in as many words). Treating a CI
 * variable as consent would silently turn every prompt into a default answer on a developer
 * machine that happens to export it.
 */

/**
 * @param {{globals: object, env: object, foremanFlag?: boolean}} input
 * @returns {{foreman: boolean, nonInteractive: boolean, interactive: boolean}}
 */
function resolveInteractivity({ globals, env, foremanFlag = false }) {
  const title = env && typeof env.FOREMAN_TASK_TITLE === 'string' ? env.FOREMAN_TASK_TITLE.trim() : '';
  const foreman = Boolean(foremanFlag) || title.length > 0;
  const nonInteractive = foreman || Boolean(globals && globals.nonInteractive);
  return { foreman, interactive: !nonInteractive, nonInteractive };
}

module.exports = { resolveInteractivity };
