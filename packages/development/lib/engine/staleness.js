'use strict';

/**
 * TRD-008 (TRD-2026-d571763f): the staleness gate as a pure function.
 *
 * `skills/staleness-gate/SKILL.md` defines the gate as arithmetic on file ages, so it is
 * expressed here as arithmetic on file ages: the caller supplies the clock, the TRD's mtime and
 * the tracked files' mtimes, and this function decides. Nothing here reads a file or a clock,
 * which is what lets a test pin a stale TRD without waiting a day for one.
 *
 * Both conditions are evaluated independently and reported independently (SG:95: "This ALWAYS
 * runs, even if STALE_AGE=true"), because a maintainer who sees only "too old" would refine the
 * TRD's date and run straight back into the drift that was the real problem.
 */

/**
 * The generated artifacts whose churn is not meaningful drift (SG:103-112). A constant, not
 * policy: the TRD-005 policy schema holds scalars and short table keys, not path patterns, and a
 * repository that renames these trees changes the generator, not a gate's threshold.
 */
const GENERATED_PATH_RE =
  /^packages\/[^/]+\/commands\/ensemble\/|^packages\/pi\/prompts\/|^packages\/codex\/\.codex\//;

/** How many newer files the message names before it summarises the rest (SG:155-158). */
const NEWER_LIST_LIMIT = 10;

/** What the gate prints when it did not run (SG:38). */
const SKIPPED_MESSAGE = 'Staleness check: skipped (resume detected)';

/** What the gate prints when it ran and found nothing (SG:140). */
const CURRENT_MESSAGE = 'Staleness check: TRD is current';

/**
 * Build the stale message exactly as SG:149-161 builds it, except for its last line: the skill
 * goes on to run `/ensemble:refine-trd` itself, while this verb is read-only and can only name
 * the command the maintainer must run.
 * @param {{ageHours: number, more: number, newer: string[], newerCount: number, staleAge: boolean,
 *   staleDrift: boolean, thresholdHours: number, trdPath: string}} input
 * @returns {string}
 */
function staleMessage(input) {
  let message = '';
  if (input.staleAge) {
    message += `TRD is ${input.ageHours}h old (threshold: ${input.thresholdHours}h).\n`;
  }
  if (input.staleDrift) {
    message += `${input.newerCount} source file(s) are newer than the TRD:\n`;
    for (const file of input.newer) message += `  - ${file}\n`;
    if (input.more > 0) message += `  (and ${input.more} more)\n`;
  }
  message += `Run /ensemble:refine-trd ${input.trdPath} before implementation, then re-run.`;
  return message;
}

/**
 * Decide whether a TRD is stale.
 * @param {{files: {mtimeSec: number, path: string}[], isResume: boolean, nowSec: number,
 *   thresholdHours: number, trdMtimeSec: number, trdPath: string}} input
 * @returns {{ageHours: number|null, checked: boolean, message: string, more: number,
 *   newer: string[], newerCount: number, stale: boolean, staleAge: boolean, staleDrift: boolean}}
 */
function evaluateStaleness(input) {
  if (input.isResume) {
    return {
      ageHours: null,
      checked: false,
      message: SKIPPED_MESSAGE,
      more: 0,
      newer: [],
      newerCount: 0,
      stale: false,
      staleAge: false,
      staleDrift: false,
    };
  }

  // Integer division then a strict `>`, as SG:83 does it: a TRD exactly at the threshold is not
  // yet stale, and the hour count the message prints is the one the comparison used.
  const ageHours = Math.floor((input.nowSec - input.trdMtimeSec) / 3600);
  const staleAge = ageHours > input.thresholdHours;

  const newerAll = input.files
    .filter(file => !GENERATED_PATH_RE.test(file.path))
    .filter(file => file.mtimeSec > input.trdMtimeSec)
    .map(file => file.path);
  const newerCount = newerAll.length;
  const staleDrift = newerCount > 0;
  const newer = newerAll.slice(0, NEWER_LIST_LIMIT);
  const more = newerCount > NEWER_LIST_LIMIT ? newerCount - NEWER_LIST_LIMIT : 0;

  const stale = staleAge || staleDrift;
  return {
    ageHours,
    checked: true,
    message: stale
      ? staleMessage({
          ageHours,
          more,
          newer,
          newerCount,
          staleAge,
          staleDrift,
          thresholdHours: input.thresholdHours,
          trdPath: input.trdPath,
        })
      : CURRENT_MESSAGE,
    more,
    newer,
    newerCount,
    stale,
    staleAge,
    staleDrift,
  };
}

module.exports = {
  CURRENT_MESSAGE,
  GENERATED_PATH_RE,
  NEWER_LIST_LIMIT,
  SKIPPED_MESSAGE,
  evaluateStaleness,
};
