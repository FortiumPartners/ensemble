'use strict';

/**
 * Review policy loader (TRD-002, REQ-001, REQ-009, REQ-016, REQ-024).
 *
 * Pure: NO shell, NO git calls, NO file reads, NO network, NO timer, NO
 * cache. The caller supplies the text of the ROOT `REVIEW.md` as it exists
 * at the base commit; this module parses the fenced
 * `ensemble-review-policy` JSON block inside it, validates every key and
 * returns one policy object.
 *
 * Why it exists:
 *
 *   1. **Editable without a release.** What a reviewer cares about -- the
 *      round cap, the depth table, bot and maintainer logins, extra
 *      sensitive and High paths, whether a Low waiver is allowed -- is data
 *      a maintainer edits in `REVIEW.md`. Nothing here is cached, so the
 *      next review reads the next edit with no code change, rebuild or
 *      release (AC-001-3, AC-016-2).
 *
 *   2. **One number, in one place.** The round cap is 3 unless the
 *      repository configures 1..5. A value outside that range, or one that
 *      is not an integer, is ignored with a warning and the default is used.
 *      Every procedure reads the cap from here; none keeps a private number
 *      (AC-009-2, AC-009-3).
 *
 *   3. **Policy is data, and it comes from the base commit.** The block is
 *      read only when the commit it came from is the review's `baseSha`: the
 *      caller reads the text with `git show <baseSha>:REVIEW.md` and passes
 *      `sourceSha` = `baseSha`, and that must match. A block that ALSO declares
 *      a `sourceSha` must declare the base, which a commit can never do for
 *      itself, so a repository's block leaves the key out. A PR therefore cannot
 *      relax its own review by editing `REVIEW.md`; prose anywhere else in
 *      the file -- or in the PR description -- is never read (AC-024-1,
 *      REQ-024). No value is ever executed, evaluated or compiled: keys are
 *      matched against a fixed, known set, and an unknown key, a wrong type
 *      or a depth bound that raises Quick above one reviewer or any verifier
 *      is rejected BY NAME while the default applies.
 *
 * Fail-closed: anything unreadable -- a bad request, an unparseable block, a
 * policy that cannot be tied to the base commit -- returns the strict
 * defaults with `ok:false` and a named reason, never a configured policy and
 * never a thrown error. Strict defaults are the cautious end of every knob:
 * cap 3, Quick at one reviewer and no verifier, no Low waiver.
 */

const { isObjectId } = require('./pr-review-scope');
const { DEFAULT_HEADROOM, deriveLimits, isSliceMaxFiles, isSliceTargetLines, isDeadlineHeadroom } = require('./pr-review-sizing');

/** The fence language a maintainer writes around the policy JSON. */
const POLICY_BLOCK_LANGUAGE = 'ensemble-review-policy';

/** The round cap the PRD fixes when a repository says nothing (AC-009-2). */
const DEFAULT_ROUND_CAP = 3;
const ROUND_CAP_MIN = 1;
const ROUND_CAP_MAX = 5;

/** Where eval cases live when a repository says nothing (TRD-031, data model). */
const DEFAULT_EVAL_CASES_DIR = 'docs/review-eval/cases';

/** Quick may never exceed this: one reviewer, no verifier (AC-016-2 bound). */
const QUICK_MAX_REVIEWERS = 1;
const QUICK_MAX_VERIFIERS = 0;

/**
 * Per-agent wall-clock budgets, in minutes (plan 3C): reviewer 15, verifier 5,
 * security lane 15. A maintainer may move each between 1 and 60. Only the
 * dispatcher stopping an agent at its deadline bounds the review's critical
 * path; this key just supplies the number (`pr-review-results.js`), and nothing
 * in this repository stops an agent yet.
 *
 * For a reviewer and the security lane the number is a BASE (kata sfpb): a deadline is
 * never shorter than it, and `pr-review-sizing.js` raises it for an agent that has more
 * to read than the base allows (`deadlineHeadroom` below). A loaded policy always holds
 * every key, set or defaulted, so an explicit value cannot be told from the default and
 * is a floor, never a pin.
 */
const DEADLINE_ROLES = Object.freeze(['reviewer', 'verifier', 'security']);
const DEFAULT_DEADLINE_MINUTES = Object.freeze({ reviewer: 15, verifier: 5, security: 15 });
const DEADLINE_MINUTES_MIN = 1;
const DEADLINE_MINUTES_MAX = 60;

/**
 * The sizing defaults (kata sfpb): how many paths and changed lines one reviewer is given, and
 * how many times the modelled reading time an agent's deadline allows. Not set here: the limits
 * are what `pr-review-sizing.js` derives from the one real full-mode run, the slice that just
 * fits the base reviewer deadline with the headroom (8 paths, 612 lines, at 15 minutes and 2),
 * and the headroom is that file's stated judgement (2), not a measurement.
 */
const DEFAULT_SLICE_LIMITS = deriveLimits({ baseMinutes: DEFAULT_DEADLINE_MINUTES.reviewer, headroom: DEFAULT_HEADROOM });

/**
 * How many agents the dispatcher should run at once, kept below the account's
 * rate limit so a fan-out does not trigger the 429s it would then have to back
 * off from; 32 is the most the orchestrator ever runs concurrently. Parsed and
 * validated here only: nothing reads it yet, so no code limits concurrency
 * until the dispatcher does.
 */
const DEFAULT_MAX_CONCURRENT_AGENTS = 8;
const MAX_CONCURRENT_AGENTS_MIN = 1;
const MAX_CONCURRENT_AGENTS_MAX = 32;

/** Deep-freeze so no caller can edit the defaults for everyone else. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * The strict defaults. Every unset key is filled from here, and the whole
 * object is the answer whenever the policy cannot be trusted.
 */
const DEFAULT_POLICY = deepFreeze({
  roundCap: DEFAULT_ROUND_CAP,
  depth: {
    quick: { reviewers: 1, verifiers: 0 },
    standard: { reviewers: 2, verifiers: 1 },
    deep: { reviewers: 3, verifiers: 3 },
  },
  botLogins: [],
  maintainerLogins: [],
  sensitivePaths: [],
  highPaths: [],
  lowWaiverEnabled: false,
  soloMaintainer: false,
  sliceThreshold: 1500,
  sliceMaxFiles: DEFAULT_SLICE_LIMITS.maxFiles,
  sliceTargetLines: DEFAULT_SLICE_LIMITS.targetLines,
  deadlineHeadroom: DEFAULT_HEADROOM,
  evalCasesDir: DEFAULT_EVAL_CASES_DIR,
  deadlineMinutes: { ...DEFAULT_DEADLINE_MINUTES },
  maxConcurrentAgents: DEFAULT_MAX_CONCURRENT_AGENTS,
});

/** A GitHub login: alphanumerics and single inner hyphens, at most 39 characters. */
const LOGIN = /^@?[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isCount = (value) => Number.isInteger(value) && value >= 0;

const isLoginList = (value) => Array.isArray(value) && value.every((entry) => isNonEmptyString(entry) && LOGIN.test(entry.trim()));
const isPathList = (value) => Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));

/** A plain JSON clone: the caller gets data it may mutate without affecting anyone else. */
const clone = (value) => JSON.parse(JSON.stringify(value));

/** The keys a maintainer may set, each with its validator. `sourceSha` is identity, not policy. */
const SIMPLE_KEYS = Object.freeze({
  botLogins: isLoginList,
  maintainerLogins: isLoginList,
  sensitivePaths: isPathList,
  highPaths: isPathList,
  lowWaiverEnabled: (value) => typeof value === 'boolean',
  soloMaintainer: (value) => typeof value === 'boolean',
  sliceThreshold: (value) => Number.isInteger(value) && value >= 1,
  sliceMaxFiles: isSliceMaxFiles,
  sliceTargetLines: isSliceTargetLines,
  deadlineHeadroom: isDeadlineHeadroom,
  // A repository-relative directory: never absolute, never climbing out of the repository.
  evalCasesDir: (value) =>
    isNonEmptyString(value) && !value.trim().startsWith('/') && !value.split(/[\\/]/).includes('..'),
  maxConcurrentAgents: (value) =>
    Number.isInteger(value) && value >= MAX_CONCURRENT_AGENTS_MIN && value <= MAX_CONCURRENT_AGENTS_MAX,
});

const KNOWN_KEYS = Object.freeze(['sourceSha', 'roundCap', 'depth', 'deadlineMinutes', ...Object.keys(SIMPLE_KEYS)]);

/** The answer when nothing can be trusted: strict defaults, named reason. */
function strict(reason, warnings = []) {
  return {
    ok: false,
    reason,
    source: 'defaults',
    policy: clone(DEFAULT_POLICY),
    rejected: [],
    warnings: warnings.includes(reason) ? warnings.slice() : [...warnings, reason],
  };
}

/** Reads the first fenced `ensemble-review-policy` block out of `text`. */
function extractBlock(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  let open = null;

  for (const line of lines) {
    const fence = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`~]*)\s*$/.exec(line);
    if (open === null) {
      if (fence && fence[2].toLowerCase() === POLICY_BLOCK_LANGUAGE) {
        open = { marker: fence[1][0], length: fence[1].length, body: [] };
      }
      continue;
    }
    if (fence && fence[1][0] === open.marker && fence[1].length >= open.length && fence[2] === '') {
      blocks.push(open.body.join('\n'));
      open = null;
      continue;
    }
    open.body.push(line);
  }
  if (open !== null) blocks.push(open.body.join('\n'));

  return blocks;
}

/** Validates one depth mode; returns the accepted mode or a rejection reason. */
function readDepthMode(name, value) {
  if (!isObject(value) || !isCount(value.reviewers) || !isCount(value.verifiers)) {
    return { reason: 'invalid-type' };
  }
  if (name === 'quick' && (value.reviewers > QUICK_MAX_REVIEWERS || value.verifiers > QUICK_MAX_VERIFIERS)) {
    return { reason: 'quick-bound-exceeded' };
  }
  return { mode: { reviewers: value.reviewers, verifiers: value.verifiers } };
}

/**
 * Loads the review policy from the root REVIEW.md text at the base commit.
 *
 * @param {Object} input
 * @param {string|null} [input.text]   The root REVIEW.md text READ FROM THE BASE COMMIT.
 *   Absent or null means the repository has no such file yet: strict defaults apply.
 * @param {string} input.baseSha       The review's base commit (full object id).
 * @param {string} [input.sourceSha]   The commit `text` was read from; must equal `baseSha`.
 * @returns {{ok:boolean, policy:Object, source:'policy'|'defaults', rejected:Array<{key:string,
 *   reason:string, value:*}>, warnings:string[], reason?:string}}
 *   `policy` is always complete and safe to use, even when `ok` is false.
 */
function loadPolicy(input) {
  if (!isObject(input)) return strict('invalid-input');

  const { text, baseSha, sourceSha } = input;
  if (text !== undefined && text !== null && typeof text !== 'string') return strict('invalid-text');

  const warnings = [];

  // --- No file yet (the first PR that introduces REVIEW.md) --------------
  if (text === undefined || text === null) {
    return {
      ok: true,
      source: 'defaults',
      policy: clone(DEFAULT_POLICY),
      rejected: [],
      warnings: ['no-policy-file'],
    };
  }

  const blocks = extractBlock(text);
  if (blocks.length === 0) {
    return {
      ok: true,
      source: 'defaults',
      policy: clone(DEFAULT_POLICY),
      rejected: [],
      warnings: ['no-policy-block'],
    };
  }
  if (blocks.length > 1) warnings.push('multiple-policy-blocks');

  let parsed;
  try {
    parsed = JSON.parse(blocks[0]);
  } catch (error) {
    return strict('policy-unparseable', warnings);
  }
  if (!isObject(parsed)) return strict('policy-not-an-object', warnings);

  // --- The policy must be the base-commit copy (REQ-024, AC-024-1) -------
  // A block cannot name the commit that contains it, so the identity is the
  // commit the CALLER read the text from (`sourceSha`, via `git show
  // <baseSha>:REVIEW.md`). A block that ALSO declares a `sourceSha` must
  // declare the base; one naming another commit is a copy from elsewhere and
  // is never read. With neither identity nothing ties the text to the base.
  const declaredSource = Object.prototype.hasOwnProperty.call(parsed, 'sourceSha') ? parsed.sourceSha : undefined;
  const sourceMatchesBase = (value) => isObjectId(value) && String(value).toLowerCase() === String(baseSha).toLowerCase();
  const hasIdentity = declaredSource !== undefined || sourceSha !== undefined;
  const declaredOk = declaredSource === undefined || sourceMatchesBase(declaredSource);
  const callerOk = sourceSha === undefined || sourceMatchesBase(sourceSha);
  if (!isObjectId(baseSha) || !hasIdentity || !declaredOk || !callerOk) return strict('policy-not-from-base', warnings);

  // --- Key by key: accept, or reject by name and use the default ---------
  const policy = clone(DEFAULT_POLICY);
  const rejected = [];
  const reject = (key, reason, value) => {
    rejected.push({ key, reason, value });
    if (!warnings.includes(reason)) warnings.push(reason);
  };

  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.includes(key)) {
      reject(key, 'unknown-key', parsed[key]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'roundCap')) {
    const cap = parsed.roundCap;
    if (Number.isInteger(cap) && cap >= ROUND_CAP_MIN && cap <= ROUND_CAP_MAX) {
      policy.roundCap = cap;
    } else {
      reject('roundCap', 'out-of-range', cap);
      if (!warnings.includes('round-cap-out-of-range')) warnings.push('round-cap-out-of-range');
    }
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'depth')) {
    const depth = parsed.depth;
    if (!isObject(depth)) {
      reject('depth', 'invalid-type', depth);
    } else {
      for (const name of Object.keys(depth)) {
        const read = readDepthMode(name, depth[name]);
        if (read.reason) reject(`depth.${name}`, read.reason, depth[name]);
        else policy.depth[name] = read.mode;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'deadlineMinutes')) {
    const deadlines = parsed.deadlineMinutes;
    if (!isObject(deadlines)) {
      reject('deadlineMinutes', 'invalid-type', deadlines);
    } else {
      for (const role of Object.keys(deadlines)) {
        const minutes = deadlines[role];
        if (!DEADLINE_ROLES.includes(role)) {
          reject(`deadlineMinutes.${role}`, 'unknown-key', minutes);
        } else if (!Number.isInteger(minutes) || minutes < DEADLINE_MINUTES_MIN || minutes > DEADLINE_MINUTES_MAX) {
          reject(`deadlineMinutes.${role}`, 'out-of-range', minutes);
        } else {
          policy.deadlineMinutes[role] = minutes;
        }
      }
    }
  }

  for (const [key, isValid] of Object.entries(SIMPLE_KEYS)) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
    const value = parsed[key];
    if (isValid(value)) policy[key] = clone(value);
    else reject(key, 'invalid-type', value);
  }

  return { ok: true, source: 'policy', policy, rejected, warnings };
}

module.exports = {
  loadPolicy,
  DEFAULT_EVAL_CASES_DIR,
  DEFAULT_POLICY,
  DEFAULT_ROUND_CAP,
  ROUND_CAP_MIN,
  ROUND_CAP_MAX,
  POLICY_BLOCK_LANGUAGE,
  KNOWN_KEYS,
  DEADLINE_ROLES,
  DEFAULT_DEADLINE_MINUTES,
  DEADLINE_MINUTES_MIN,
  DEADLINE_MINUTES_MAX,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  MAX_CONCURRENT_AGENTS_MIN,
  MAX_CONCURRENT_AGENTS_MAX,
};
