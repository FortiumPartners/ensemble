'use strict';

/**
 * pr-review-sizing.js -- how much one reviewer is given to read, and how long an agent is given to read it (kata sfpb,
 * epic ptqb).
 *
 * NO side effects, NO shell, NO network, NO file reads, no requires: plain numbers in, plain numbers out. The policy
 * loader (`pr-review-policy.js`), the deadline function (`pr-review-results.js`) and the runner (`pr-review-run.js`) all
 * read their sizing from here, so there is ONE model and one place its numbers come from.
 *
 * THE DEFECT. The first real full-mode run (PR 271: 19 files, 1450 changed lines, one `whole-pr` slice because that is
 * under the 1500-line threshold) had no slice smaller than the PR, and every agent had the flat 15-minute default:
 *   - the security lane, which must read every changed path, arrived 2m45s after its deadline and was recorded `expired`;
 *   - one of the two reviewers of the slice listed 5 of its 19 paths, and a slice counts as reviewed only when EVERY
 *     reviewer of it covered every path, so `whole-pr` was reported not reviewed.
 * Both were the runner failing closed correctly. What was wrong was the plan it was given: a slice and a deadline that
 * did not depend on how much there was to read.
 *
 * THE OBSERVATION. Everything below except the headroom is derived from OBSERVED, which is that run's own record (`run.json`:
 * what each agent was dispatched with and when its result file arrived; the result files: the paths each agent listed in
 * `pathsReviewed`). The headroom is the one CHOSEN number, and its comment says what it is set against.
 *
 * THE MODEL.
 *   estimate(work)  = max(files x MINUTES_PER_FILE, lines / 100 x MINUTES_PER_100_LINES)       minutes to read `work`
 *     MINUTES_PER_FILE      = the slowest agent that read EVERY path, divided by the paths   (the lane: 17.75 / 19)
 *     MINUTES_PER_100_LINES = the same agent's time, divided by the changed lines / 100      (the lane: 17.75 / 14.5)
 *   Only an agent that read everything gives a time to read a whole slice, so the partial reviewer is not a rate. The larger
 *   of the two terms is taken because a path costs a read however few lines it holds (a rename, a one-line file) and a long
 *   file costs by its length: whichever term is bigger for THIS slice is the one that binds.
 *
 *   deadline(work)  = clamp(ceil(estimate(work) x headroom), base, MAX)
 *     base    the policy's `deadlineMinutes[role]` (15 by default): the model only ever RAISES a deadline above it. The loaded
 *             policy always holds every key, defaulted or not, so an explicit value cannot be told from the default: it is
 *             a floor, never a pin.
 *     MAX     the policy's own ceiling for a deadline, 60 minutes. A modelled need above it is capped AND SAID (`capped`).
 *     headroom  DEFAULT_HEADROOM = 2: a JUDGEMENT, not a measurement. The run holds ONE observation of each agent, so it cannot
 *             say how far one agent's time for identical work varies, and nothing here derives that. The three ratios it does
 *             show, which 2 is set against:
 *               1.18  the lane's time over the flat deadline it was given (17.75 / 15): the margin the lane lacked;
 *               1.70  reviewer-s1-a over reviewer-s1-b (7.84 / 4.62), two reviewers of one assignment but NOT of the same
 *                     work: s1-b listed 5 of the 19 paths and stopped 10.4 minutes inside its deadline;
 *               2.26  the lane over reviewer-s1-a (17.75 / 7.84), the only two agents that read the same 19 paths, under
 *                     different lenses (security against general).
 *             2 is the round number above the first two. It is below the third on purpose: the rates are the lane's, the slower
 *             of that pair, so a reviewer's estimate is already 2.26 times what s1-a took. A deadline of one times the estimate
 *             would leave no margin over the slowest agent seen. The choice moves the plan if the CONSTANT moves: at 2.5 the
 *             limits are 6 paths and 490 lines, the real PR needs four slices (nine agents, one more than the default cap holds
 *             in one wave) and the lane is given 45 minutes. The policy key `deadlineHeadroom` changes the deadlines only (the
 *             limits are the keys `sliceMaxFiles` and `sliceTargetLines`); if live runs show agents slower than twice the
 *             slowest rate seen, raise it.
 *
 *   slice limits    the same model solved for the slice that just fits the base reviewer deadline, with its headroom:
 *     maxFiles    = floor(base / (headroom x MINUTES_PER_FILE))                    8 at 15 minutes and 2x
 *     targetLines = floor(base / (headroom x MINUTES_PER_100_LINES / 100))         612 at 15 minutes and 2x
 *   A slice inside both limits is one the slowest observed reader finishes within HALF the reviewer's deadline. Smaller
 *   slices are what let a reviewer reach every path; the deadline model is what keeps the lane (one agent over the whole PR)
 *   alive. The run this was derived from comes out as 3 slices of 8, 3 and 8 paths (454, 556 and 440 changed lines), a reviewer
 *   deadline of 15 minutes and a lane deadline of 36.
 *
 * The three numbers a maintainer can set (`sliceMaxFiles`, `sliceTargetLines`, `deadlineHeadroom`) are policy keys; their
 * defaults are what this file derives (the two limits) and states (the headroom), and `pr-review-policy.js` takes them from
 * `deriveLimits` and `DEFAULT_HEADROOM`.
 *
 * HONEST LIMITS -- what this model is not:
 *   - ONE run. The rates are one completed read by one agent (the lane) on one PR with one model, and the run holds no spread of
 *     one agent's time on identical work (the headroom above is a judgement). The model is proportional through the origin (no
 *     fixed cost for starting an agent) while the lane's elapsed time includes its start-up, so a fixed cost makes it UNDER-state
 *     a small slice (the 15-minute base covers that in practice), and it cannot say anything about a slice shape the run did not
 *     have. Recalibrating it is an edit of OBSERVED with a new run's numbers, in review.
 *   - Elapsed time is dispatch to the arrival of the result file: it holds whatever the agent spent starting up and queueing,
 *     and it is the model's and the tooling's speed of that run. A slower model or tool needs a larger `deadlineHeadroom`.
 *   - Time is not the only way a reviewer fails to reach a path. The reviewer that listed 5 of 19 paths (318 of 1450 lines)
 *     stopped 10.4 minutes inside its deadline: the result files do not say whether the brief's 40-call limit or its own choice
 *     ended it, and 5 paths and 318 lines are fewer than a slice may hold. A smaller slice and a diff holding only that slice
 *     make reaching every path feasible; nothing here can make a reviewer do it. If live runs show reviewers stopping short of
 *     their slice, lower `sliceMaxFiles` and `sliceTargetLines` (and raise `maxConcurrentAgents`, which holds the number of
 *     slices). A reviewer that lists fewer paths than its slice is still reported `paths-not-reviewed`, and an agent that
 *     arrives after its (larger) deadline is still `expired`: no limit in this file relaxes a fail-closed rule, it only
 *     changes the plan.
 *   - The lane is ONE agent over the whole PR. Its modelled deadline passes the 60-minute maximum at about 32 files or 2,450
 *     changed lines (the default headroom); past that the deadline is capped, the run says so, and a lane that does not
 *     arrive leaves the security review missing.
 *   - Like every deadline here, the runner computes it and the dispatcher must enforce it.
 */

const MINUTE_MS = 60 * 1000;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Deep-freeze so no caller can edit the observation for everyone else. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * The one real full-mode run, as its own files record it (the run directory of PR 271, kata dqcs, head 0ad5628):
 *   `files`, `changedLines`  `numstat` of that run: added + deleted lines over all 19 changed paths, one `whole-pr` slice;
 *   `deadlineMinutes`        the deadline every agent was given;
 *   `agents[].elapsedMs`     `arrivedAt - dispatchedAt` of the agent in `run.json` (result file arrival);
 *   `agents[].reachedFiles`/`reachedLines`  the paths in the agent's own `pathsReviewed`, and the changed lines they hold.
 * The lane arrived 2m45s after its deadline (the kata's title); reviewer-s1-b listed 5 paths and left 14, 1132 lines.
 */
const OBSERVED = deepFreeze({
  run: 'real271',
  pr: 271,
  files: 19,
  changedLines: 1450,
  deadlineMinutes: 15,
  agents: [
    { name: 'security-lane', role: 'security', elapsedMs: 1065040, reachedFiles: 19, reachedLines: 1450 },
    { name: 'reviewer-s1-a', role: 'reviewer', elapsedMs: 470399, reachedFiles: 19, reachedLines: 1450 },
    { name: 'reviewer-s1-b', role: 'reviewer', elapsedMs: 277359, reachedFiles: 5, reachedLines: 318 },
  ],
});

const minutesOf = (agent) => agent.elapsedMs / MINUTE_MS;

/** The agents that read every path of the slice: only their time is a time to read a WHOLE slice. */
const COMPLETED = OBSERVED.agents.filter((agent) => agent.reachedFiles === OBSERVED.files);
const SLOWEST_COMPLETED_MINUTES = Math.max(...COMPLETED.map(minutesOf));

/** Minutes per changed path, and per 100 changed lines, of the slowest agent that read everything. */
const MINUTES_PER_FILE = SLOWEST_COMPLETED_MINUTES / OBSERVED.files;
const MINUTES_PER_100_LINES = SLOWEST_COMPLETED_MINUTES / (OBSERVED.changedLines / 100);

/**
 * The three ratios the run shows between what agents took. None is a spread of ONE agent's time on identical work, which the run
 * does not hold: the headroom below is set against them, it is not computed from them.
 *   LANE_OVERRUN        the lane's time over the flat deadline it was given;
 *   REVIEWER_SPREAD     the slower reviewer over the faster, two reviewers of one assignment that did NOT do the same work (the
 *                       faster listed 5 of the 19 paths);
 *   LANE_OVER_REVIEWER  the lane over the reviewer that read the same 19 paths, under a different lens.
 */
const LANE = OBSERVED.agents.find((agent) => agent.role === 'security');
const LANE_OVERRUN = minutesOf(LANE) / OBSERVED.deadlineMinutes;
const REVIEWER_MINUTES = OBSERVED.agents.filter((agent) => agent.role === 'reviewer').map(minutesOf);
const REVIEWER_SPREAD = Math.max(...REVIEWER_MINUTES) / Math.min(...REVIEWER_MINUTES);
const SAME_PATHS_REVIEWER = OBSERVED.agents.find((agent) => agent.role === 'reviewer' && agent.reachedFiles === LANE.reachedFiles);
const LANE_OVER_REVIEWER = minutesOf(LANE) / minutesOf(SAME_PATHS_REVIEWER);

/**
 * How many times the modelled time to read its work an agent's deadline allows. CHOSEN, not derived (see the header): 2, above the
 * first two ratios and below the third, because the rates are the lane's and so already 2.26 times what a reviewer of the same
 * paths took.
 */
const DEFAULT_HEADROOM = 2;

/** A headroom below 1 would give an agent less time than the model says it needs; above 10 no deadline can be told from the cap. */
const HEADROOM_MIN = 1;
const HEADROOM_MAX = 10;

/**
 * THE FIXED COST OF AN AGENT (kata d9sy). The size model above is proportional through the origin: it has no cost for starting
 * an agent, and it was derived from agents at the default effort. The first real measurements at effort `hi` (kata q3a9; each
 * line is `run.json`: dispatch to the arrival of the result file) show that a reviewer's time on a SMALL slice does not follow its size:
 *
 *   run pr207-hi-q3c   8 paths  77 lines   14.58 min and 9.12 min   (two lenses on one slice)
 *                      6 paths 327 lines   10.62 and 9.39
 *                      4 paths 323 lines    8.24 and 10.62
 *                     18 paths 727 lines   13.87 (the whole-range reader)
 *   run pr277-first    4 paths 280 lines   12.77, and one reviewer NOT arrived at its 15 min deadline (stopped; so >= 15.0)
 *   run pr277-re       4 paths 285 lines    7.17 and 7.27 (two other reviewers, one re-review of the same four paths)
 *
 * A 77-line slice took as long as a 727-line one, and the same four paths took 12.8 and more than 15 minutes in one run and 7.2
 * and 7.3 in a re-review: a per-agent cost with a wide spread, not a rate. What the record does NOT show: the lost reviewer has no
 * arrival and no last message, so a slow agent cannot be told from a hung one. The floor helps the slow case only; a hung agent
 * now holds the run 22 minutes instead of 15 and its slice is still reported not reviewed. What it does show is no delay at the
 * spawn call: the orchestrator's dispatch logs (run2 and run3 `dispatch.log.jsonl`) put it 10 to 11 ms after the manifest for the
 * review rounds (about 0.4 s for the verify rounds), in one wave of three agents under a cap of 8, and the deadline clock starts at
 * the dispatch; the agent's own start is not recorded, so queueing after the spawn call is not excluded. The
 * model's estimate for the 4-path slice is 3.7 minutes, doubled 8, so the 15-minute base decided, with 0.4 minutes of margin over the
 * slowest finished reviewer (14.58) and none over the one that did not arrive.
 *
 * So a sized agent's deadline has a floor: the slowest reviewer that FINISHED a small slice at effort `hi`, times FLOOR_FACTOR.
 * FLOOR_FACTOR (1.5) is a JUDGEMENT like DEFAULT_HEADROOM: with 10 reviewers measured it is half again the slowest finished and
 * about half again the base (22.5 against 22), and the one that did not arrive needed over 15. It is not a guarantee: a reviewer slower than 22 minutes is
 * still `expired`, its slice still reported not reviewed, and nothing here relaxes that. The floor applies whatever a policy's
 * `deadlineMinutes` says (a policy raises a deadline above it, it cannot lower it below what was measured, and a value of the policy
 * below it, 15 included, is named in the run's sizing warnings; an unset value is raised without a warning); the slice limits and the headroom are unchanged, because slicing finer does not
 * shorten a fixed cost. It was measured at effort `hi`; the runner records no effort and applies it at whatever effort the
 * dispatcher uses.
 */
const OBSERVED_HI_EFFORT = deepFreeze({
  run: 'q3a9',
  /** Finished reviewers of a slice inside the slice limits, in minutes from dispatch to result. */
  finishedReviewerMinutes: [14.58, 9.12, 10.62, 9.39, 8.24, 10.62, 12.77, 7.17, 7.27],
  /** Reviewers that had not arrived at their deadline: their time is only bounded below by the deadline they were given (censored), so the floor is not computed from it; the tests assert the floor clears it. */
  expiredReviewerMinutes: [15],
});
const SLOWEST_FINISHED_MINUTES = Math.max(...OBSERVED_HI_EFFORT.finishedReviewerMinutes);
const FLOOR_FACTOR = 1.5;
/** The least any sized agent (reviewer, whole-range reader, security lane) is given: 22 minutes. */
const MIN_AGENT_MINUTES = Math.ceil(SLOWEST_FINISHED_MINUTES * FLOOR_FACTOR);

/** The roles whose time depends on how much they read. A verifier settles at most three claims, whatever the PR's size. */
const SIZED_ROLES = Object.freeze(['reviewer', 'security']);

const isSliceMaxFiles = (value) => Number.isInteger(value) && value >= 1;
const isSliceTargetLines = (value) => Number.isInteger(value) && value >= 1;
const isDeadlineHeadroom = (value) => typeof value === 'number' && Number.isFinite(value) && value >= HEADROOM_MIN && value <= HEADROOM_MAX;

const isCount = (value) => Number.isInteger(value) && value >= 0;

/** `{ files, lines }`: what an agent is asked to read, as whole non-negative counts. */
const isWork = (value) => isObject(value) && isCount(value.files) && isCount(value.lines);

/** Modelled minutes to read `work`: whichever of the per-file and per-line terms is larger. Unrounded. */
function estimateMinutes(work) {
  return Math.max(work.files * MINUTES_PER_FILE, (work.lines / 100) * MINUTES_PER_100_LINES);
}

/**
 * An agent's deadline in whole minutes: the estimate with its headroom, never below `base`, never below the fixed-cost `floor`
 * (MIN_AGENT_MINUTES) and never above `maximum`.
 *
 * @param {Object} input
 * @param {number} input.base      The role's base deadline in minutes (the policy's `deadlineMinutes[role]`).
 * @param {{files:number, lines:number}} input.work
 * @param {number} input.headroom
 * @param {number} input.maximum   The most any deadline may be (60 minutes).
 * @param {number} [input.floor]   The fixed-cost floor in minutes (default MIN_AGENT_MINUTES).
 * @returns {{minutes:number, base:number, estimate:number, headroom:number, modeled:number, floor:number, raised:boolean, floored:boolean, capped:boolean}}
 *   `modeled` is the headroomed estimate in whole minutes; `raised` says the model made `minutes` longer than `base`;
 *   `floored` says the floor, not the size, decided it (the slice is small enough that its estimate is below the floor);
 *   `capped` says the modelled need is more than `maximum` allows (so the agent is given less than the model says it needs).
 */
function sizedMinutes({ base, work, headroom, maximum, floor = MIN_AGENT_MINUTES }) {
  const estimate = estimateMinutes(work);
  const modeled = Math.ceil(estimate * headroom);
  const minutes = Math.min(Math.max(base, modeled, floor), maximum);
  return {
    minutes,
    base,
    estimate,
    headroom,
    modeled,
    floor,
    raised: minutes > base,
    floored: floor > modeled && floor > base && minutes === floor,
    capped: modeled > maximum,
  };
}

/**
 * The largest slice that fits `baseMinutes` with `headroom`: the model solved for the slice instead of the time. A slice with
 * at most `maxFiles` paths and `targetLines` changed lines is modelled at `baseMinutes` or less, headroom included.
 *
 * @param {{baseMinutes:number, headroom:number}} input
 * @returns {{maxFiles:number, targetLines:number}}  each at least 1
 */
function deriveLimits({ baseMinutes, headroom }) {
  return {
    maxFiles: Math.max(1, Math.floor(baseMinutes / (headroom * MINUTES_PER_FILE))),
    targetLines: Math.max(1, Math.floor((baseMinutes * 100) / (headroom * MINUTES_PER_100_LINES))),
  };
}

/**
 * The three sizing numbers one run uses: the policy's where it holds a readable one, else `defaults`'. A policy value that is
 * present and unreadable is NAMED in `warnings` (`invalid-<key>`) and the default is used, never the unreadable value.
 *
 * @param {Object|null} policy    A loaded policy (`loadPolicy(...).policy`); null or absent keys fall back to `defaults`.
 * @param {{sliceMaxFiles:number, sliceTargetLines:number, deadlineHeadroom:number}} defaults
 * @returns {{maxFiles:number, targetLines:number, headroom:number, warnings:string[]}}
 */
function resolveSizing(policy, defaults) {
  const warnings = [];
  const read = (key, valid) => {
    const value = isObject(policy) ? policy[key] : undefined;
    if (value === undefined) return defaults[key];
    if (valid(value)) return value;
    warnings.push(`invalid-${key}`);
    return defaults[key];
  };
  return {
    maxFiles: read('sliceMaxFiles', isSliceMaxFiles),
    targetLines: read('sliceTargetLines', isSliceTargetLines),
    headroom: read('deadlineHeadroom', isDeadlineHeadroom),
    warnings,
  };
}

/** The model's two rates, rounded for a record a person reads (the arithmetic always uses the unrounded constants). */
const round3 = (value) => Math.round(value * 1000) / 1000;
const MODEL = Object.freeze({ minutesPerFile: round3(MINUTES_PER_FILE), minutesPer100Lines: round3(MINUTES_PER_100_LINES) });

module.exports = {
  OBSERVED,
  MODEL,
  MINUTES_PER_FILE,
  MINUTES_PER_100_LINES,
  LANE_OVERRUN,
  REVIEWER_SPREAD,
  LANE_OVER_REVIEWER,
  DEFAULT_HEADROOM,
  OBSERVED_HI_EFFORT,
  FLOOR_FACTOR,
  MIN_AGENT_MINUTES,
  HEADROOM_MIN,
  HEADROOM_MAX,
  SIZED_ROLES,
  isWork,
  isSliceMaxFiles,
  isSliceTargetLines,
  isDeadlineHeadroom,
  estimateMinutes,
  sizedMinutes,
  deriveLimits,
  resolveSizing,
};
