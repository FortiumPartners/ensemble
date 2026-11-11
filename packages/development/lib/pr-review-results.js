'use strict';

/**
 * Review results by file, agent deadlines and agent-failure classification
 * (kata et2k, epic ptqb, plan docs/plans/pr-review-speedup-plan.md section 3C).
 *
 * What this module does, and what it deliberately does not
 * --------------------------------------------------------
 *
 * HONEST LIMIT. This is repository code that COMPUTES things: the deadline an
 * agent is given, the state each expected result file is in, and what to do
 * about an API failure. It does NOT kill, stop or time out any agent, and it
 * cannot. Whatever dispatches the agents (the `runner` child owns dispatch)
 * must stop an agent at the `deadlineAt` computed here, and must keep the
 * number of agents running at once below the `maxConcurrentAgents` policy key,
 * which this module never reads. Until it does, a deadline is a number in a
 * report and that key is a validated number in a policy file: neither is
 * enforcement, and nothing here, or in a document that cites this module, may
 * claim otherwise. No skill or command calls this module yet.
 *
 * What this module DOES guarantee is the other half, against a writer that
 * cannot move the system clock or act as another user: a result file counts as
 * arrived only when its last change is no later than its deadline and no
 * earlier than its dispatch. "Last change" is the inode change time (ctime),
 * which `touch -t`, `cp -p` and renaming an early temp file into place cannot
 * set backwards; the modification time, which any writer can set, is not used.
 *
 * Three pure-ish building blocks (fs is allowed in this module, and only
 * `collectResults` touches it, through injectable `deps` as in
 * local-ci-runner.js; `pr-review-cli.js` itself stays free of file reads):
 *
 *   reviewDeadlines({tier, depth, role, now, policy?, work?}) -> {dispatchedAt, deadlineAt, ...}
 *     reviewer 15 min, verifier 5 min, security lane 15 min, overridable per
 *     role by the `deadlineMinutes` policy key (1..60 minutes, validated by
 *     pr-review-policy.js). `tier` and `depth` are validated and echoed; they
 *     do not change the budget. `work` ({files, lines}: what the agent is asked to
 *     read) does, for a reviewer and the security lane (kata sfpb): the budget is then
 *     a BASE that `pr-review-sizing.js` raises to the modelled time to read that much,
 *     with headroom, up to the 60-minute maximum, and never lowers; a verifier's
 *     does not depend on it. Those numbers are BASES: a reviewer and the lane are never
 *     given less than a fixed-cost floor of 22 minutes (kata d9sy) and a verifier never
 *     less than 8 (kata dx53), whatever the policy says; a policy value set below a
 *     floor is overridden and named in `warnings`. `dispatchedAt` is `now`:
 *     hand both it and `deadlineAt` to `collectResults`.
 *
 *   collectResults({expected, dir, now, scratchDir?}, deps?)
 *     Each expected agent writes `out-<name>.json` into `dir`; its entry says
 *     when it was dispatched (`dispatchedAt`) and when it must be done
 *     (`deadlineAt`). Every agent is classified, from the files alone:
 *       arrived  a valid result whose last change falls in
 *                [dispatchedAt, deadlineAt];
 *       missing  nothing from this dispatch yet, before the deadline
 *                (`pending: true`: collect again). A file whose last change is
 *                before `dispatchedAt` (another round's result in a reused
 *                directory, a placeholder) is "nothing yet", with the reason
 *                `stale-result-before-dispatch`;
 *       expired  nothing valid in time: the deadline passed with nothing from
 *                this dispatch, or the file's last change was after it.
 *                Final, never read as reviewed;
 *       invalid  a file exists but cannot be used: empty, truncated, not JSON,
 *                not a regular file, too large, changed while it was read or
 *                the wrong schema. The file is quarantined under
 *                `<scratchDir>/quarantine/` with its reason and the agent
 *                counts as not reviewed. (`pending` stays true until the
 *                deadline, because an agent that is still writing
 *                non-atomically can leave a half file that a later pass finds
 *                complete. Dispatch should have agents write a temp file and
 *                rename it. The rename is the change that counts, so an agent
 *                that renames after its deadline is late.)
 *     A yield that is a JSON STRING holding the object (the string-versus-object
 *     retry the plan measured) is parsed once more and accepted; anything
 *     deeper is invalid.
 *     The moment a valid result is seen it is copied to `scratchDir`, with its
 *     arrival (the change time above) stored as the copy's modification time.
 *     A scratch copy of THIS dispatch is authoritative from then on:
 *     classification is a function of (expected, dir contents, scratch
 *     contents, now), so an orchestrator that crashed and is restarted
 *     re-collects over the same directory and reaches the same answer, and a
 *     file the agent later deletes changes nothing; one it later REWRITES is
 *     looked at again and reported (A RESULT FILE THAT CHANGES AFTER IT WAS
 *     READ, below), never silently kept or silently dropped. A scratch
 *     copy that arrived before `dispatchedAt` belongs to an earlier round: it
 *     is ignored, with a warning, and replaced by the new arrival.
 *     A RESULT FILE THAT CHANGES AFTER IT WAS READ (kata 271n). The collector
 *     cannot know whether an agent has finished writing, and the first valid
 *     file it saw used to be the only one it ever read: a rewrite a minute later
 *     (measured: 9 of 37 files in three live runs, one a vote that would have
 *     confirmed a finding, one a finding that reached no candidate) was lost
 *     without a word. Now every `arrived` record carries `read`, the fingerprint
 *     `{ size, mtimeMs, ctimeMs, sha256 }` of the version in use, which the
 *     caller stores next to the arrival and hands back as `expected[].read`
 *     (without it the fingerprint of the scratch copy, the bytes taken, is the
 *     baseline). Each later pass looks at the file again and compares its BYTES
 *     (sha256) with the baseline:
 *       the same bytes  nothing changed; a touched file, or one rewritten with
 *                       the same content, is not a change;
 *       other bytes     `changed: { kind: 'rewritten', read, now, usable, why? }`:
 *                       `read` and `now` are the two fingerprints. `usable` is
 *                       true when the later version is a valid result whose change
 *                       time lies in [dispatchedAt, deadlineAt]. With
 *                       `expected[].reread: true` (the caller has not used this
 *                       agent's result yet) a usable later version REPLACES the
 *                       scratch copy and the record says `reread: { from, to }`
 *                       instead of `changed`: the latest usable version wins, and
 *                       the arrival is its change time. Without `reread`, or when
 *                       the later version is invalid, late (`why:
 *                       arrived-after-deadline`, a late result is never read),
 *                       or the copy could not be updated, the version first read
 *                       stands and `changed` says what the file holds now: the
 *                       caller MUST flag it and never keep it silently;
 *       swapped         `kind: 'replaced'` (no longer a regular file) or
 *                       `'unreadable'` (it cannot be read now, or is too large);
 *       gone            `kind: 'removed'`: the copy stands and nothing was lost,
 *                       so it is reported and is not a change of the result.
 *     A malformed `read` or `reread` is a refusal of the request. Without a usable
 *     scratch directory the first version is kept nowhere: the result files alone
 *     are judged, so a later version is the data of that pass, and `changed` says
 *     so (`kept: false`: no copy of the first version stands). A pass over an
 *     untouched directory answers byte for byte the same.
 *     TRUST. `dir` is where the agents write, so nothing in it is trusted
 *     beyond the one file `out-<name>.json`, and that file is read through a
 *     single descriptor opened without following symlinks and without
 *     blocking (a symlink, FIFO, device or directory there is `invalid:
 *     not-a-regular-file`; a swap or rewrite while it is read is `invalid:
 *     file-changed-during-read`). What the orchestrator itself keeps, scratch
 *     copies and quarantine, therefore lives OUTSIDE `dir`: `scratchDir`
 *     defaults to the hidden sibling `<parent of dir>/.<name of dir>.collected`
 *     (`defaultScratchDir`), and a `scratchDir` inside `dir`, or containing
 *     it, is refused. It is created mode 0700 and must be a real directory
 *     (not a symlink) owned by this user and writable by nobody else;
 *     otherwise it is neither read nor written, with a warning, and the result
 *     files alone are judged. Every write to it is an exclusive create of a
 *     randomly named temp file followed by a rename, so a symlink planted at a
 *     guessable name is never followed. Limit: file modes do not stop an agent
 *     that runs as the same user and deliberately goes looking for the scratch
 *     directory; run agents so that they can write only inside `dir`.
 *     An expired, missing or invalid agent never silently becomes "reviewed":
 *       - a verifier that did not arrive is named in `incompleteVerifiers`
 *         (with the candidate ids it was assigned, or null for every
 *         candidate when the assignment is unknown), which `tallyVotes` turns
 *         into `unverified` / `verifier-incomplete`, presented and never
 *         counted as agreement;
 *       - a reviewer that did not arrive, or arrived without having covered
 *         every path of its slice, leaves that slice in `unreviewedSlices`.
 *         A slice counts as reviewed only when EVERY reviewer assigned to it
 *         arrived and covered it, so one expired lens leaves the slice not
 *         reviewed (plan 3A crosses each slice with more than one lens). A
 *         reviewer given a `sliceId` must also be given its `paths` and its
 *         `lens`: a slice with no paths to check would count as reviewed by
 *         anyone, and a reviewer with no lens is not a distinct pass, so such a
 *         request is refused, and so is a `lens` that is not a lens token
 *         (lower case letters, digits and `-`, at most 32 characters: the
 *         grammar of the reviewer brief). `reviewedBy` lists, apart from that
 *         all-or-nothing slice rule, each reviewer that arrived and covered
 *         every path of its slice as `{ sliceId, lens, reviewer, paths }`:
 *         what `verifyCoverage` counts distinct lenses from, so one expired
 *         lens costs only its own pass. `paths` are the paths the reviewer was
 *         asked to read and reported having read: a lens is credited to those
 *         paths and to no others, so a slice whose `expected.paths` was left
 *         short is not covered for the paths nobody was asked to read.
 *     `ok` is true only when the request was readable and every agent
 *     arrived; the lists are filled either way so a partial result is usable.
 *
 *   classifyAgentFailure({status, retryAfterSec, message, attempt?, waitedSec?, now?, deadlineAt?}) ->
 *       {retry, delayMs, fallbackRoute, failFast, state, kind, reason}
 *     Rate limits and overloads are retried after a backoff, on the alternate
 *     model route; a retry-after beyond `failFastAfterSec` (default 300, the
 *     length of a verifier's whole budget), unreadable failures, client errors
 *     and exhausted retries fail fast to `state: 'partial'`, which the caller
 *     records, instead of stalling for hours. That threshold caps the TOTAL
 *     waiting too: the caller passes the seconds it has already waited for this
 *     agent (`waitedSec`), so three 299 s retry-afters cannot eat a whole
 *     budget. Given the agent's `deadlineAt` and the current `now`, a wait that
 *     would end at or after that deadline fails fast as well: `now` already
 *     contains the earlier waits, so waiting cannot run past the deadline.
 *
 * Wiring: `collectResults` -> `toVotesInput` produces the exact payload of the
 * `votes` subcommand / `tallyVotes`; `reviewedBy` is the `reviewedBy` array
 * of the `slices` subcommand / `verifyCoverage`.
 *
 * FAIL CLOSED: an unreadable request returns `ok:false` with a reason and
 * empty results ("no agents" is never "all reviewed"); a failure this module
 * cannot classify is a fail-fast, never a retry loop.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { DEADLINE_ROLES, DEFAULT_DEADLINE_MINUTES, DEADLINE_MINUTES_MIN, DEADLINE_MINUTES_MAX, DEFAULT_POLICY } = require('./pr-review-policy');
const { SIZED_ROLES, isWork, isDeadlineHeadroom, sizedMinutes, verifierMinutes } = require('./pr-review-sizing');
const { VERDICTS } = require('./pr-review-votes');
const { LENS_TOKEN } = require('./pr-review-depth');

const MINUTE_MS = 60 * 1000;

/** The tiers and depths this module recognises when asked to echo them. */
const TIERS = Object.freeze(['low', 'medium', 'high']);
const DEPTHS = Object.freeze(['quick', 'standard', 'deep']);

/** A result file larger than this is not a review result. */
const MAX_RESULT_BYTES = 8 * 1024 * 1024;

/** Safe to splice into a file name: no separators, no `..`, no leading dot. */
const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_FAIL_FAST_AFTER_SEC = 300;
const RATE_LIMIT_BACKOFF_MS = 30 * 1000;
const TRANSIENT_BACKOFF_MS = 10 * 1000;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Text identity for ids that may be written as a string or a finite number. */
const identity = (value) => (isText(value) ? value.trim() : Number.isFinite(value) ? String(value) : null);

/** The latest instant a Date can hold: a bigger number is not a time, and `toISOString` throws on it. */
const MAX_EPOCH_MS = 8.64e15;

/** Epoch milliseconds from a finite number or an ISO string; `null` when neither. */
function toMillis(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value <= MAX_EPOCH_MS ? value : null;
  if (isText(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

function deadlineFailure(reason) {
  return { ok: false, reason, deadlineAt: null, budgetMs: 0, warnings: [] };
}

/** The one sentence a floor that overrides a policy `deadlineMinutes` is reported in (the warning here and the run's sizing warning). */
function floorOverrideMessage({ role, policyMinutes, floorMinutes }) {
  const holder = role === 'verifier' ? 'a verifier (kata dx53)' : 'a reviewer or security agent (kata d9sy)';
  return `policy deadlineMinutes.${role} (${policyMinutes}) is below the ${floorMinutes}-minute fixed-cost floor of ${holder}; the deadline is ${floorMinutes} minutes`;
}

/**
 * The `deadlineMinutes` the policy block SET for `role`, or null when it set none. `input.explicit` (loadPolicy's `explicit`: what the
 * policy block set) tells a set value from the policy's defaults, a value equal to the default included; a caller without it can only
 * tell a value that differs from the default.
 */
function policySetMinutes(input, role, minutes, source) {
  const setByPolicy = isObject(input.explicit) && isObject(input.explicit.deadlineMinutes) ? input.explicit.deadlineMinutes[role] : undefined;
  if (isObject(input.explicit)) return Number.isInteger(setByPolicy) ? setByPolicy : null;
  return source === 'policy' && minutes !== DEFAULT_DEADLINE_MINUTES[role] ? minutes : null;
}

/**
 * The wall-clock deadline for one agent that starts at `now`.
 *
 * @param {Object} input
 * @param {string} input.role      `reviewer` | `verifier` | `security`.
 * @param {number|string} input.now  Epoch ms or ISO string: when the agent is dispatched.
 * @param {string} [input.tier]    `low` | `medium` | `high`; validated and echoed.
 * @param {string} [input.depth]   `quick` | `standard` | `deep`; validated and echoed.
 * @param {Object} [input.policy]  A loaded policy (`loadPolicy(...).policy`); its
 *   `deadlineMinutes[role]` overrides the default when it is a 1..60 integer, and its
 *   `deadlineHeadroom` sets how many times the modelled reading time `work` is given.
 * @param {Object} [input.explicit]  What the policy block SET (`loadPolicy(...).explicit`, `{deadlineMinutes: {role: minutes}}`): with it
 *   a policy value below the floor is named whatever it equals (15 included); without it only a value that differs from the default is.
 * @param {{files:number, lines:number}} [input.work]  What the agent is asked to read, as whole non-negative counts.
 *   With it, a reviewer's and the security lane's deadline is the larger of the base above, the modelled reading time with its
 *   headroom and the fixed-cost floor of an agent (`MIN_AGENT_MINUTES`, kata d9sy), at most 60 minutes; without it the base alone
 *   (the floor of a reviewer or the lane applies only with `work`). A verifier's deadline is never sized: it is the larger of the
 *   base and its own fixed-cost floor (`MIN_VERIFIER_MINUTES`, kata dx53, at most 60 minutes), with or without `work`.
 * @returns {{ok:boolean, role?:string, dispatchedAt?:number, deadlineAt:number|null, deadlineAtIso?:string, budgetMs:number,
 *   minutes?:number, source?:'default'|'policy'|'size', sizing?:Object, tier?:string, depth?:string, warnings:string[], reason?:string}}
 *   `source` is `size` only when the size model or a floor set `minutes` above the base. `sizing` (present when `work` was used for a
 *   reviewer or the lane, and always for a verifier) is `{files, lines, baseMinutes, estimateMinutes, headroom, modeledMinutes,
 *   floorMinutes, floored, raised, capped}` for the sized roles: `floored` says the floor decided the deadline; `capped` says the
 *   modelled need is over the 60-minute maximum and the agent is given the maximum, which is less than the model says it needs. For
 *   a verifier it is `{baseMinutes, floorMinutes, floored, policyMinutes, overridesPolicy, raised}`: `overridesPolicy` says the
 *   policy SET a value below the floor and the floor was applied (named in `warnings`).
 */
function reviewDeadlines(input) {
  if (!isObject(input)) return deadlineFailure('invalid-input');
  const role = isText(input.role) ? input.role.trim().toLowerCase() : null;
  if (role === null || !DEADLINE_ROLES.includes(role)) {
    return deadlineFailure(`unknown role ${JSON.stringify(input.role)} (expected ${DEADLINE_ROLES.join(', ')})`);
  }
  const now = toMillis(input.now);
  if (now === null) return deadlineFailure('now must be epoch milliseconds or an ISO timestamp');

  const result = { role };
  for (const [key, allowed] of [['tier', TIERS], ['depth', DEPTHS]]) {
    if (input[key] === undefined) continue;
    const value = isText(input[key]) ? input[key].trim().toLowerCase() : null;
    if (value === null || !allowed.includes(value)) {
      return deadlineFailure(`unknown ${key} ${JSON.stringify(input[key])} (expected ${allowed.join(', ')})`);
    }
    result[key] = value;
  }

  const warnings = [];
  let minutes = DEFAULT_DEADLINE_MINUTES[role];
  let source = 'default';
  const configured = isObject(input.policy) && isObject(input.policy.deadlineMinutes) ? input.policy.deadlineMinutes[role] : undefined;
  if (configured !== undefined) {
    if (Number.isInteger(configured) && configured >= DEADLINE_MINUTES_MIN && configured <= DEADLINE_MINUTES_MAX) {
      minutes = configured;
      source = 'policy';
    } else {
      warnings.push(`policy deadlineMinutes.${role} is out of range; the default applies`);
    }
  }

  // The base is what the policy (or the default) says; an agent with more to read than it allows is given longer, never shorter.
  let sizing;
  if (input.work !== undefined) {
    if (!isWork(input.work)) return deadlineFailure('work must be { files, lines }, each a whole, non-negative number');
    if (!SIZED_ROLES.includes(role)) {
      warnings.push(`work does not change a ${role}'s deadline`);
    } else {
      let headroom = DEFAULT_POLICY.deadlineHeadroom;
      const stated = isObject(input.policy) ? input.policy.deadlineHeadroom : undefined;
      if (stated !== undefined) {
        if (isDeadlineHeadroom(stated)) headroom = stated;
        else warnings.push('policy deadlineHeadroom is out of range; the default applies');
      }
      const sized = sizedMinutes({ base: minutes, work: input.work, headroom, maximum: DEADLINE_MINUTES_MAX });
      // A policy value the policy SET below the floor is overridden, and that is said (a value equal to the default included).
      const policyMinutes = policySetMinutes(input, role, minutes, source);
      const overridesPolicy = sized.floored && policyMinutes !== null && policyMinutes < sized.floor;
      sizing = { files: input.work.files, lines: input.work.lines, baseMinutes: sized.base, estimateMinutes: sized.estimate, headroom: sized.headroom, modeledMinutes: sized.modeled, floorMinutes: sized.floor, floored: sized.floored, policyMinutes, overridesPolicy, raised: sized.raised, capped: sized.capped };
      if (overridesPolicy) warnings.push(floorOverrideMessage({ role, policyMinutes, floorMinutes: sized.floor }));
      if (sized.capped) warnings.push(`the modelled need of ${sized.modeled} minutes for this ${role} is over the ${DEADLINE_MINUTES_MAX}-minute maximum; the deadline is capped at ${DEADLINE_MINUTES_MAX}`);
      if (sized.raised) source = 'size';
      minutes = sized.minutes;
    }
  }

  // A verifier is never sized (its time does not follow its claims: pr-review-sizing.js, kata dx53) and has a fixed-cost floor of its
  // own, with or without `work`: the base, or the floor when that is longer. A policy value SET below it is overridden, and that is said.
  if (role === 'verifier') {
    const fixed = verifierMinutes({ base: minutes, maximum: DEADLINE_MINUTES_MAX });
    const policyMinutes = policySetMinutes(input, role, minutes, source);
    const overridesPolicy = fixed.floored && policyMinutes !== null && policyMinutes < fixed.floor;
    sizing = { baseMinutes: fixed.base, floorMinutes: fixed.floor, floored: fixed.floored, policyMinutes, overridesPolicy, raised: fixed.raised };
    if (overridesPolicy) warnings.push(floorOverrideMessage({ role, policyMinutes, floorMinutes: fixed.floor }));
    if (fixed.raised) source = 'size';
    minutes = fixed.minutes;
  }

  const budgetMs = minutes * MINUTE_MS;
  const deadlineAt = now + budgetMs;
  if (deadlineAt > MAX_EPOCH_MS) return deadlineFailure('now is too late to hold a deadline');
  return {
    ok: true,
    ...result,
    dispatchedAt: now,
    deadlineAt,
    deadlineAtIso: new Date(deadlineAt).toISOString(),
    budgetMs,
    minutes,
    source,
    ...(sizing === undefined ? {} : { sizing }),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Result files
// ---------------------------------------------------------------------------

/** The facts this module reads about one entry: the entry itself, never what a symlink points at. */
function statFacts(stat) {
  return {
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    ino: stat.ino,
    dev: stat.dev,
    uid: stat.uid,
    mode: stat.mode,
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The sha256 of a result file's text, as lower-case hex: what two reads of the same bytes have in common. */
const sha256Of = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * What one read of a result file saw, so a later look can tell whether it is still that file (kata 271n): its size, its
 * modification and change times (when the entry reports them) and the sha256 of its bytes. The BYTES decide whether it
 * changed; the rest is what a person reads beside them (`first read 212 bytes, now 240`).
 */
function fingerprintOf(stat, text) {
  const print = { size: Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : Buffer.byteLength(text, 'utf8') };
  if (Number.isFinite(stat.mtimeMs)) print.mtimeMs = stat.mtimeMs;
  if (Number.isFinite(stat.ctimeMs)) print.ctimeMs = stat.ctimeMs;
  print.sha256 = sha256Of(text);
  return print;
}

/** A fingerprint a caller handed back (`expected[].read`): a size, a sha256 and, when given, finite times. */
function isFingerprint(value) {
  if (!isObject(value)) return false;
  if (!Number.isSafeInteger(value.size) || value.size < 0) return false;
  if (typeof value.sha256 !== 'string' || !SHA256_HEX.test(value.sha256)) return false;
  return ['mtimeMs', 'ctimeMs'].every((key) => value[key] === undefined || Number.isFinite(value[key]));
}

/** A copy of a checked fingerprint with exactly its own keys, in the order `fingerprintOf` writes them. */
function copyFingerprint(value) {
  const print = { size: value.size };
  if (value.mtimeMs !== undefined) print.mtimeMs = value.mtimeMs;
  if (value.ctimeMs !== undefined) print.ctimeMs = value.ctimeMs;
  print.sha256 = value.sha256;
  return print;
}

/** An error whose `code` this module maps to a named reason, like the `code` of an fs error. */
function fileError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Why a directory cannot hold the orchestrator's own state, or `null` when it can. It must be a real directory
 * (a symlink could be aimed anywhere), owned by this user and writable by nobody else.
 */
function privateDirProblem(stat) {
  if (!isObject(stat) || stat.isDirectory !== true) return 'not a real directory (a symlink, a file or unreadable)';
  if (process.platform === 'win32') return null; // owner and mode bits mean nothing there
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return 'owned by another user';
  if ((stat.mode & 0o022) !== 0) return 'writable by group or others';
  return null;
}

/** Creates (mode 0700) or re-checks a directory that holds orchestrator state; `EUNSAFE` when it is not private. */
function ensurePrivateDir(target) {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const problem = privateDirProblem(statFacts(fs.lstatSync(target)));
  if (problem !== null) throw fileError('EUNSAFE', `${target} is ${problem}`);
}

/** open(2) flags for a path an agent controls: never follow a final symlink, never block opening a FIFO. */
const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);

/**
 * Injectable file access, so every failure case can be driven without a real disk:
 *   lstat(file)                      facts about the entry itself (a symlink is not followed), or `null` when absent
 *   readFile(file, expected?)        the text of one regular file within the size limit, or a coded error
 *   writeFile(file, text, mtimeMs)   atomic, and never through a path an agent could have aimed
 */
function defaultDeps() {
  return {
    lstat(file) {
      try {
        return statFacts(fs.lstatSync(file));
      } catch (error) {
        if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
        throw error;
      }
    },
    /**
     * One descriptor decides everything. It is opened without following a final symlink and without blocking on a
     * FIFO; the type, size and times come from the descriptor, not from the path (which can be swapped between a
     * check and a read); and the bytes come from it, bounded. `expected` is the `lstat` taken just before: another
     * inode, size or change time means the file was swapped or rewritten in between, and so does any change while
     * it is read (`ECHANGED`), so the change time judged is the change time of the bytes returned.
     */
    readFile(file, expected) {
      const fd = fs.openSync(file, READ_FLAGS);
      try {
        const before = fs.fstatSync(fd);
        if (!before.isFile()) throw fileError('ENOTREG', `${file} is not a regular file`);
        if (before.size > MAX_RESULT_BYTES) throw fileError('EFBIG', `${file} is larger than ${MAX_RESULT_BYTES} bytes`);
        if (isObject(expected) && (before.ino !== expected.ino || before.dev !== expected.dev || before.size !== expected.size || before.ctimeMs !== expected.ctimeMs)) {
          throw fileError('ECHANGED', `${file} was replaced or rewritten after it was inspected`);
        }
        const capacity = before.size + 1; // the spare byte notices a file that grew
        const buffer = Buffer.allocUnsafe(capacity);
        let filled = 0;
        while (filled < capacity) {
          const read = fs.readSync(fd, buffer, filled, capacity - filled, null);
          if (read === 0) break;
          filled += read;
        }
        const after = fs.fstatSync(fd);
        if (filled > before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
          throw fileError('ECHANGED', `${file} changed while it was read`);
        }
        return buffer.toString('utf8', 0, filled);
      } finally {
        fs.closeSync(fd);
      }
    },
    /**
     * An exclusive create (`wx`) of a randomly named temp file beside the target, so a symlink or file planted at any
     * guessable name is never opened; then a rename, which replaces a symlink at the target instead of following it.
     * The directory must be private (`ensurePrivateDir`).
     */
    writeFile(file, text, mtimeMs) {
      const parent = path.dirname(file);
      ensurePrivateDir(parent);
      const temp = path.join(parent, `.${path.basename(file)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
      const fd = fs.openSync(temp, 'wx', 0o600);
      try {
        try {
          fs.writeFileSync(fd, text);
          if (Number.isFinite(mtimeMs)) fs.futimesSync(fd, mtimeMs / 1000, mtimeMs / 1000);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(temp, file);
      } catch (error) {
        try {
          fs.unlinkSync(temp);
        } catch (ignored) {
          // never renamed into place, or already gone: nothing is left to clean up
        }
        throw error;
      }
    },
  };
}

/** A schema check never throws: it answers the first reason the yield is unusable. */
function checkReviewer(value) {
  if (!Array.isArray(value.findings) || !value.findings.every(isObject)) return { reason: 'invalid-findings' };
  if (!Array.isArray(value.pathsReviewed) || !value.pathsReviewed.every(isText)) return { reason: 'invalid-paths-reviewed' };
  return {
    findings: value.findings,
    pathsReviewed: value.pathsReviewed.map((entry) => entry.trim().replace(/^\.\//, '')),
  };
}

function checkVerifier(value) {
  if (!Array.isArray(value.votes) || !value.votes.every(isObject)) return { reason: 'invalid-votes' };
  const votes = [];
  for (const vote of value.votes) {
    const candidateId = identity(vote.candidateId);
    if (candidateId === null) return { reason: 'vote-needs-candidate-id' };
    const verdict = isText(vote.verdict) ? vote.verdict.trim().toLowerCase() : null;
    if (verdict === null || !VERDICTS.includes(verdict)) return { reason: 'unknown-verdict' };
    votes.push({ candidateId, verdict });
  }
  return { votes };
}

/**
 * JSON text -> the agent's object. A string whose content is the JSON object is
 * the "string instead of object" yield: parsed once more, and only once.
 */
function parseYield(text) {
  const body = typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
  if (body.trim() === '') return { reason: 'empty-file' };
  let value;
  try {
    value = JSON.parse(body);
    if (typeof value === 'string') value = JSON.parse(value);
  } catch (error) {
    return { reason: 'unparseable-json' };
  }
  if (!isObject(value)) return { reason: 'yield-not-an-object' };
  return { value };
}

/** The reason an unreadable file is named: the codes `readFile` throws for a symlink, a size, a swap or a rewrite. */
function readFailureReason(error) {
  const code = (error && error.code) || 'error';
  if (code === 'ELOOP' || code === 'EMLINK' || code === 'ENOTREG') return 'not-a-regular-file';
  if (code === 'EFBIG') return 'result-too-large';
  if (code === 'ECHANGED') return 'file-changed-during-read';
  return `unreadable-file:${code}`;
}

/**
 * Reads and validates one result file. Never throws; every failure is a named reason.
 *
 * @param {string} file
 * @param {{role:string, dispatchedAt:number}} agent
 * @param {Object} io
 * @param {'ctimeMs'|'mtimeMs'} timeField  Where the arrival comes from. A result file's own change time (ctime): the
 *   agent that wrote it cannot set it backwards. A scratch copy's modification time: the orchestrator stored the
 *   arrival there when it took the copy, in a directory only it can write.
 * @returns `absent`; `stale` (it last changed before the dispatch, so it is not this dispatch's); `invalid` with a
 *   reason (and the text and its fingerprint `read`, when it could be read); or `valid` with the checked data, the text
 *   and its fingerprint. Each carries `arrivedAt` once the change time is known.
 */
function inspectFile(file, agent, io, timeField) {
  let stat;
  try {
    stat = io.lstat(file);
  } catch (error) {
    return { status: 'invalid', reason: `unreadable-file:${(error && error.code) || 'error'}` };
  }
  if (stat === null) return { status: 'absent' };
  if (!stat.isFile) return { status: 'invalid', reason: 'not-a-regular-file' };
  if (stat.size > MAX_RESULT_BYTES) return { status: 'invalid', reason: 'result-too-large' };
  const arrivedAt = Number.isFinite(stat[timeField]) ? Math.round(stat[timeField]) : null;
  if (arrivedAt === null) return { status: 'invalid', reason: 'no-arrival-time' };
  if (arrivedAt < agent.dispatchedAt) return { status: 'stale', arrivedAt };

  let text;
  try {
    text = io.readFile(file, stat);
  } catch (error) {
    return { status: 'invalid', reason: readFailureReason(error), arrivedAt };
  }

  const parsed = parseYield(text);
  const read = fingerprintOf(stat, text);
  if (parsed.reason) return { status: 'invalid', reason: parsed.reason, arrivedAt, text, read };
  const checked = agent.role === 'verifier' ? checkVerifier(parsed.value) : checkReviewer(parsed.value);
  if (checked.reason) return { status: 'invalid', reason: checked.reason, arrivedAt, text, read };
  return { status: 'valid', data: checked, arrivedAt, text, read };
}

function collectFailure(reason) {
  return {
    ok: false,
    reason,
    complete: false,
    agents: [],
    findings: [],
    votes: [],
    incompleteVerifiers: [],
    reviewedSlices: [],
    reviewedBy: [],
    unreviewedSlices: [],
    unreviewedDetail: [],
    warnings: [],
  };
}

/** One path is the other, or lies inside it. */
function overlaps(a, b) {
  const relative = path.relative(a, b);
  return relative === '' || (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative));
}

/**
 * Where the orchestrator keeps its copies when the caller names no `scratchDir`: a hidden sibling of `dir`, never
 * inside it, because the agents write inside `dir` and nothing they can write to can be trusted.
 */
function defaultScratchDir(dir) {
  const resolved = path.resolve(dir);
  return path.join(path.dirname(resolved), `.${path.basename(resolved)}.collected`);
}

/** Request validation: every problem is a refusal, because a guess here is a false "reviewed". */
function readExpected(input) {
  if (!isObject(input)) return { reason: 'invalid-input' };
  if (!isText(input.dir)) return { reason: 'dir must be a non-empty string' };
  if (!Array.isArray(input.expected) || input.expected.length === 0) {
    return { reason: 'expected must be a non-empty array of agents' };
  }
  const now = toMillis(input.now);
  if (now === null) return { reason: 'now must be epoch milliseconds or an ISO timestamp' };
  if (input.scratchDir !== undefined && !isText(input.scratchDir)) return { reason: 'scratchDir must be a non-empty string' };

  const dir = path.resolve(input.dir);
  if (path.dirname(dir) === dir) return { reason: 'dir must not be a filesystem root' };
  const scratchDir = input.scratchDir === undefined ? defaultScratchDir(dir) : path.resolve(input.scratchDir);
  if (overlaps(dir, scratchDir) || overlaps(scratchDir, dir)) {
    return { reason: 'scratchDir must be outside dir: the agents write in dir, so nothing kept there can be trusted' };
  }

  const agents = [];
  const seen = new Set();
  for (const [index, entry] of input.expected.entries()) {
    const label = `expected[${index}]`;
    if (!isObject(entry)) return { reason: `${label} must be an object` };
    if (!isText(entry.name) || !AGENT_NAME.test(entry.name) || entry.name.includes('..')) {
      return { reason: `${label}.name ${JSON.stringify(entry.name)} is not a safe file-name part` };
    }
    const key = entry.name.toLowerCase();
    if (seen.has(key)) return { reason: `${label}.name ${JSON.stringify(entry.name)} is listed twice` };
    seen.add(key);
    const role = isText(entry.role) ? entry.role.trim().toLowerCase() : null;
    if (role === null || !DEADLINE_ROLES.includes(role)) {
      return { reason: `${label}.role must be one of ${DEADLINE_ROLES.join(', ')}` };
    }
    const deadlineAt = toMillis(entry.deadlineAt);
    if (deadlineAt === null) return { reason: `${label}.deadlineAt must be epoch milliseconds or an ISO timestamp` };
    const dispatchedAt = toMillis(entry.dispatchedAt);
    if (dispatchedAt === null) {
      return { reason: `${label}.dispatchedAt must be epoch milliseconds or an ISO timestamp: a result written before the dispatch is another round's` };
    }
    if (deadlineAt <= dispatchedAt) return { reason: `${label}.deadlineAt must be later than dispatchedAt` };

    const agent = { name: entry.name, role, dispatchedAt, deadlineAt };
    if (entry.sliceId !== undefined) {
      if (!isText(entry.sliceId)) return { reason: `${label}.sliceId must be a non-empty string` };
      agent.sliceId = entry.sliceId.trim();
    }
    if (entry.lens !== undefined) {
      if (!isText(entry.lens)) return { reason: `${label}.lens must be a non-empty string` };
      if (role === 'verifier' || agent.sliceId === undefined) {
        return { reason: `${label}.lens belongs to a reviewer given a sliceId` };
      }
      agent.lens = entry.lens.trim().toLowerCase();
      if (!LENS_TOKEN.test(agent.lens)) {
        return { reason: `${label}.lens must be a lens token: lower case letters, digits and "-", at most 32 characters (the grammar of the reviewer brief), not ${JSON.stringify(entry.lens)}` };
      }
    }
    if (entry.paths !== undefined) {
      if (!Array.isArray(entry.paths) || !entry.paths.every(isText)) return { reason: `${label}.paths must be an array of paths` };
      agent.paths = entry.paths.map((p) => p.trim().replace(/^\.\//, ''));
    }
    if (role !== 'verifier' && agent.sliceId !== undefined && (agent.paths === undefined || agent.paths.length === 0)) {
      return { reason: `${label}.paths must list the paths of slice ${JSON.stringify(agent.sliceId)}: a slice with no paths to check would count as reviewed by anyone` };
    }
    if (role !== 'verifier' && agent.sliceId !== undefined && agent.lens === undefined) {
      return { reason: `${label}.lens must name the lens of the reviewer of slice ${JSON.stringify(agent.sliceId)}: a reviewer with no lens is not a distinct pass` };
    }
    if (entry.candidateIds !== undefined) {
      const ids = Array.isArray(entry.candidateIds) ? entry.candidateIds.map(identity) : [null];
      if (ids.includes(null)) return { reason: `${label}.candidateIds must be an array of ids` };
      agent.candidateIds = ids;
    }
    if (entry.read !== undefined) {
      if (!isFingerprint(entry.read)) return { reason: `${label}.read must be the fingerprint a collect answered for this agent: { size, sha256 (64 hex characters) and, when given, finite mtimeMs and ctimeMs }` };
      agent.read = copyFingerprint(entry.read);
    }
    if (entry.reread !== undefined) {
      if (typeof entry.reread !== 'boolean') return { reason: `${label}.reread must be true or false` };
      agent.reread = entry.reread;
    }
    agents.push(agent);
  }
  return { agents, now, dir, scratchDir };
}

/**
 * Whether the scratch directory may be read and written. Absent is fine (the first write creates it, private); a
 * symlink, or a directory that is foreign or shared, is not: an agent could have put anything in it, so its contents
 * are neither read as arrivals nor added to.
 */
function checkScratch(io, scratchDir, warnings) {
  let stat;
  try {
    stat = io.lstat(scratchDir);
  } catch (error) {
    const code = (error && error.code) || 'error';
    warnings.push(`scratch directory ${scratchDir} could not be inspected (${code}); it was not used`);
    return { usable: false, error: `scratch-unreadable:${code}` };
  }
  if (stat === null) return { usable: true };
  const problem = privateDirProblem(stat);
  if (problem === null) return { usable: true };
  warnings.push(`scratch directory ${scratchDir} is ${problem}; it was not used`);
  return { usable: false, error: 'unsafe-scratch-dir' };
}

/** `212 bytes, sha256 1a2b3c4d5e6f`: a fingerprint as a person reads it in a warning. */
const describePrint = (print) => (isObject(print) ? `${print.size} bytes, sha256 ${String(print.sha256).slice(0, 12)}` : 'not readable');

/**
 * What the result file holds now (`live`, a look by `inspectFile`) against what was read (`baseline`, a fingerprint), or `null`
 * when it still holds the bytes that were read (a touch, or a rewrite with the same content, is not a change). Otherwise the
 * change: `{ kind, now, usable, why? }`:
 *   removed     the entry is gone; the copy taken stands and nothing was lost, so a caller does not count it as a change
 *   replaced    it is no regular file any more (a link, a directory, a FIFO)
 *   unreadable  it cannot be read now (too large, changed under the read, no change time, permission), or lies before the dispatch
 *   rewritten   other bytes. `usable` when they are a valid result whose change time is within the deadline: a caller that has
 *               not used the result may take them. Otherwise `why` says what is wrong (the validation reason, or
 *               `arrived-after-deadline`: a late result is never read).
 */
function compareWithRead(live, baseline, agent) {
  if (live.status === 'absent') return { kind: 'removed', now: null, usable: false, why: 'removed' };
  if (live.read === undefined) {
    const why = live.status === 'stale' ? 'stale-result-before-dispatch' : live.reason || 'unreadable-file';
    return { kind: why === 'not-a-regular-file' ? 'replaced' : 'unreadable', now: null, usable: false, why };
  }
  if (live.read.sha256 === baseline.sha256) return null;
  if (live.status !== 'valid') return { kind: 'rewritten', now: live.read, usable: false, why: live.reason };
  if (live.arrivedAt > agent.deadlineAt) return { kind: 'rewritten', now: live.read, usable: false, why: 'arrived-after-deadline' };
  return { kind: 'rewritten', now: live.read, usable: true };
}

/**
 * The warning a change after the read is reported as in the answer of the pass that saw it. `kept` is whether a copy still stands
 * for the first read: without one (no usable scratch directory, or a copy that is not the version recorded) the pass counts what
 * the file holds now, and says so.
 */
function changeWarning(file, changed, kept) {
  const first = describePrint(changed.read);
  const stands = kept ? 'the version first read stands' : 'no copy of the version first read is kept, so this pass counts what the file holds now';
  if (changed.kind === 'removed') return `${file}: removed after it was read; ${kept ? 'the copy taken stands' : 'no copy of it is kept'} (${first})`;
  if (changed.kind === 'rewritten') {
    const now = describePrint(changed.now);
    if (changed.usable) return `${file}: changed after it was read (first read ${first}, now ${now}); ${stands}`;
    return `${file}: changed after it was read (first read ${first}, now ${now}) and the later version cannot be used (${changed.why}); ${stands}`;
  }
  return `${file}: ${changed.kind === 'replaced' ? 'replaced by something that is not a regular file' : 'no longer readable'} after it was read (${changed.why}); ${stands} (${first})`;
}

/**
 * Classifies every expected agent from its result file and builds the inputs
 * `tallyVotes` and `verifyCoverage` consume. See the module header.
 *
 * @param {Object} input
 * @param {Object[]} input.expected  `{name, role, dispatchedAt, deadlineAt, sliceId?, lens?, paths?, candidateIds?, read?, reread?}` per
 *   agent. `role` is reviewer|verifier|security; `dispatchedAt` and `deadlineAt` come from `reviewDeadlines` (a result
 *   that last changed before `dispatchedAt` is not this dispatch's); a reviewer's `sliceId` says which slice it owns,
 *   `paths` (required with `sliceId`) lists that slice's paths and `lens` (required with `sliceId`) the emphasis it
 *   reads them under; a verifier's `candidateIds` say which candidates it was assigned. `read` is the fingerprint an earlier
 *   answer gave for this agent's `arrived` record (`{size, mtimeMs?, ctimeMs?, sha256}`), the version the caller has used or
 *   will use; `reread: true` says the caller has NOT used the result yet, so a later valid version in time replaces it (kata
 *   271n: see the module header). Every `arrived` record answers its `read`, and a file that holds other bytes than it
 *   answers `changed` (or `reread`), however many passes ago the first read was.
 * @param {string} input.dir         Where the agents write `out-<name>.json`.
 * @param {number|string} input.now  The moment of observation.
 * @param {string} [input.scratchDir]  Defaults to `defaultScratchDir(dir)`; never inside `dir`.
 * @param {Object} [deps]            `{lstat, readFile, writeFile}`; real fs by default (`defaultDeps()`).
 */
function collectResults(input, deps) {
  const io = deps === undefined ? defaultDeps() : deps;
  const request = readExpected(input);
  if (request.reason) return collectFailure(request.reason);
  const { agents, now, dir, scratchDir } = request;

  const warnings = [];
  const scratch = checkScratch(io, scratchDir, warnings);
  const records = agents.map((agent) => {
    const file = `out-${agent.name}.json`;
    const primary = path.join(dir, file);
    const kept = path.join(scratchDir, file);
    const record = { name: agent.name, role: agent.role, dispatchedAt: agent.dispatchedAt, deadlineAt: agent.deadlineAt };
    if (agent.sliceId !== undefined) record.sliceId = agent.sliceId;
    if (agent.lens !== undefined) record.lens = agent.lens;
    if (agent.candidateIds !== undefined) record.candidateIds = agent.candidateIds.slice();

    const safeWrite = (target, text, mtimeMs) => {
      if (!scratch.usable) {
        record.scratchError = scratch.error;
        return false;
      }
      try {
        io.writeFile(target, text, mtimeMs);
        return true;
      } catch (error) {
        warnings.push(`could not write ${target}: ${(error && error.code) || 'error'}`);
        record.scratchError = (error && error.code) || 'error';
        return false;
      }
    };

    // A scratch copy was validated when it was taken, so the first valid arrival of THIS dispatch is the one that
    // counts. A copy that arrived before the dispatch is an earlier round's: it is ignored, never trusted.
    let earlier = scratch.usable ? inspectFile(kept, agent, io, 'mtimeMs') : { status: 'absent' };
    if (earlier.status === 'stale') warnings.push(`${kept}: ignored a scratch copy from before this dispatch`);
    else if (earlier.status === 'invalid') warnings.push(`${kept}: ignored an unusable scratch copy (${earlier.reason})`);
    // A copy that is not the version the caller recorded as used is not the data in use (a crash between taking the copy and
    // recording it, or a copy somebody edited): it is ignored, and the file itself is read and compared with the record.
    if (earlier.status === 'valid' && agent.read !== undefined && earlier.read.sha256 !== agent.read.sha256) {
      warnings.push(`${kept}: ignored a scratch copy that is not the version recorded as read`);
      earlier = { status: 'absent' };
    }
    const fromScratch = earlier.status === 'valid';
    // What was read first (kata 271n): the caller's record, else the bytes of the copy taken, when it arrived in time. Without either
    // there is nothing to compare and this is the first look.
    const baseline = agent.read !== undefined ? agent.read : fromScratch && earlier.arrivedAt <= agent.deadlineAt ? { size: earlier.read.size, sha256: earlier.read.sha256 } : null;
    // What the result file holds NOW: with a copy standing for the first read this is a second look, without one it is the first.
    const live = inspectFile(primary, agent, io, 'ctimeMs');
    let seen = fromScratch ? earlier : live;
    const difference = baseline === null ? null : compareWithRead(live, baseline, agent);
    // A later version that is valid and in time replaces the copy that stands for the first read ONLY when the caller has not used the
    // result yet (`reread`); otherwise the version first read stands and the change is reported, never kept or dropped in silence.
    let adopted = false;
    if (difference !== null && difference.usable && agent.reread === true) {
      if (!fromScratch) {
        adopted = true; // no copy stands for the first read: the file itself is this pass's data already
      } else if (safeWrite(kept, live.text, live.arrivedAt)) {
        seen = live;
        adopted = true;
      } else {
        difference.usable = false;
        difference.why = 'scratch-not-updated';
      }
    }
    if (adopted) {
      record.reread = { from: baseline, to: live.read };
      warnings.push(`${primary}: rewritten after it was read and before its result was used: the later version replaces the first (first read ${describePrint(baseline)}, now ${describePrint(live.read)})`);
    } else if (difference !== null) {
      record.changed = { kind: difference.kind, read: baseline, now: difference.now, usable: difference.usable, ...(difference.why === undefined ? {} : { why: difference.why }), ...(fromScratch ? {} : { kept: false }) };
      warnings.push(changeWarning(primary, record.changed, fromScratch));
    }
    // The fingerprint of the version whose data this pass uses.
    const inUse = () => {
      if (adopted) return live.read;
      if (agent.read !== undefined && (difference === null || fromScratch)) return agent.read;
      if (fromScratch) return difference === null ? live.read : baseline;
      return seen.read;
    };

    if (seen.status === 'valid') {
      if (fromScratch || safeWrite(kept, seen.text, seen.arrivedAt)) record.scratchPath = kept;
      record.arrivedAt = seen.arrivedAt;
      if (seen.arrivedAt <= agent.deadlineAt) {
        record.state = 'arrived';
        record.pending = false;
        record.data = seen.data;
        record.read = inUse();
      } else {
        record.state = 'expired';
        record.reason = 'arrived-after-deadline';
        record.pending = false;
      }
    } else if (seen.status === 'invalid') {
      record.state = 'invalid';
      record.reason = seen.reason;
      record.pending = now < agent.deadlineAt;
      const quarantine = path.join(scratchDir, 'quarantine');
      if (typeof seen.text === 'string') safeWrite(path.join(quarantine, file), seen.text, seen.arrivedAt);
      safeWrite(path.join(quarantine, `out-${agent.name}.reason.json`), JSON.stringify({ name: agent.name, reason: seen.reason }) + '\n');
      if (scratch.usable) record.quarantinePath = path.join(quarantine, file);
    } else {
      // Nothing of THIS dispatch has been written: no file, or only one that last changed before the dispatch.
      const absentReason = seen.status === 'stale' ? 'stale-result-before-dispatch' : null;
      if (now >= agent.deadlineAt) {
        record.state = 'expired';
        record.reason = absentReason === null ? 'deadline-passed' : absentReason;
        record.pending = false;
      } else {
        record.state = 'missing';
        record.reason = absentReason === null ? 'not-yet-written' : absentReason;
        record.pending = true;
      }
    }
    return { agent, record };
  });

  // --- Aggregation ------------------------------------------------------
  const findings = [];
  const votes = [];
  const incompleteVerifiers = [];
  const slices = new Map(); // id -> {reasons: [], missingPaths: []}
  const reviewedBy = [];

  for (const { agent, record } of records) {
    const arrived = record.state === 'arrived';
    if (agent.role === 'verifier') {
      if (!arrived) {
        incompleteVerifiers.push({
          verifier: agent.name,
          reason: record.reason === undefined ? record.state : `${record.state}:${record.reason}`,
          candidateIds: agent.candidateIds === undefined ? null : agent.candidateIds.slice(),
        });
        continue;
      }
      for (const vote of record.data.votes) votes.push({ verifier: agent.name, candidateId: vote.candidateId, verdict: vote.verdict });
      continue;
    }

    // reviewer and security lane
    let missingPaths = [];
    let readPaths = [];
    if (arrived) {
      for (const finding of record.data.findings) findings.push({ ...finding, reviewer: agent.name });
      if (agent.paths !== undefined) {
        const reviewedPaths = new Set(record.data.pathsReviewed);
        missingPaths = agent.paths.filter((p) => !reviewedPaths.has(p));
        readPaths = agent.paths.filter((p) => reviewedPaths.has(p));
      }
    }
    if (agent.sliceId !== undefined) {
      const slice = slices.get(agent.sliceId) || { reasons: [], missingPaths: [] };
      if (!arrived) slice.reasons.push({ agent: agent.name, reason: `${record.state}:${record.reason}` });
      else if (missingPaths.length > 0) {
        slice.reasons.push({ agent: agent.name, reason: 'paths-not-reviewed' });
        for (const p of missingPaths) if (!slice.missingPaths.includes(p)) slice.missingPaths.push(p);
      } else {
        reviewedBy.push({ sliceId: agent.sliceId, lens: agent.lens, reviewer: agent.name, paths: readPaths });
      }
      slices.set(agent.sliceId, slice);
    }
  }

  const reviewedSlices = [];
  const unreviewedDetail = [];
  for (const [id, slice] of slices) {
    if (slice.reasons.length === 0) reviewedSlices.push(id);
    else unreviewedDetail.push({ sliceId: id, reasons: slice.reasons, missingPaths: slice.missingPaths });
  }

  const complete = records.every(({ record }) => record.state === 'arrived');
  const result = {
    ok: complete,
    complete,
    agents: records.map(({ record }) => {
      const { data, ...rest } = record;
      return rest;
    }),
    findings,
    votes,
    incompleteVerifiers,
    reviewedSlices,
    reviewedBy,
    unreviewedSlices: unreviewedDetail.map((entry) => entry.sliceId),
    unreviewedDetail,
    warnings,
  };
  if (!complete) result.reason = 'incomplete';
  return result;
}

/**
 * The `votes` payload for a collection: every candidate carries the votes cast
 * on it and the verifiers that were assigned to it but returned nothing usable.
 *
 * @param {Object} collected  A `collectResults` answer.
 * @param {Object} options
 * @param {string} options.depth                `quick` | `standard` | `deep`.
 * @param {number} [options.expectedVerifiers]
 * @param {Object[]} [options.candidates]       The deduplicated candidate findings; defaults to the reviewers' findings.
 * @returns {{findings:Object[], depth:string, expectedVerifiers?:number, ignoredVotes:Object[]}|{ok:false, reason:string}}
 *   `ignoredVotes` lists votes dropped for naming a candidate the verifier was not assigned.
 */
function toVotesInput(collected, options) {
  if (!isObject(collected) || !Array.isArray(collected.votes) || !Array.isArray(collected.incompleteVerifiers)) {
    return { ok: false, reason: 'collected must be a collectResults answer' };
  }
  const opts = isObject(options) ? options : {};
  const candidates = opts.candidates === undefined ? collected.findings : opts.candidates;
  if (!Array.isArray(candidates)) return { ok: false, reason: 'candidates must be an array' };

  const assigned = new Map(); // verifier -> Set(candidateId) | null (unknown = every candidate)
  for (const entry of collected.incompleteVerifiers) assigned.set(entry.verifier, entry.candidateIds === null ? null : new Set(entry.candidateIds));
  for (const agent of Array.isArray(collected.agents) ? collected.agents : []) {
    if (agent.role === 'verifier' && agent.state === 'arrived' && Array.isArray(agent.candidateIds)) {
      assigned.set(agent.name, new Set(agent.candidateIds));
    }
  }

  const ignoredVotes = [];
  const findings = candidates.map((candidate) => {
    const id = isObject(candidate) ? identity(candidate.id) : null;
    if (id === null) return candidate; // tallyVotes refuses a finding with no id, loudly
    const cast = [];
    for (const vote of collected.votes) {
      if (vote.candidateId !== id) continue;
      const scope = assigned.get(vote.verifier);
      if (scope instanceof Set && !scope.has(id)) {
        ignoredVotes.push({ verifier: vote.verifier, candidateId: id, reason: 'candidate-not-assigned' });
        continue;
      }
      cast.push({ verifier: vote.verifier, verdict: vote.verdict });
    }
    const incomplete = collected.incompleteVerifiers
      .filter((entry) => entry.candidateIds === null || entry.candidateIds.includes(id))
      .map((entry) => ({ verifier: entry.verifier, reason: entry.reason }));
    for (const [verifier, scope] of assigned) {
      if (!(scope instanceof Set) || !scope.has(id)) continue;
      if (incomplete.some((entry) => entry.verifier === verifier) || cast.some((vote) => vote.verifier === verifier)) continue;
      incomplete.push({ verifier, reason: 'no-vote-for-candidate' });
    }
    return { ...candidate, votes: cast, incompleteVerifiers: incomplete };
  });

  const payload = { findings, depth: opts.depth, ignoredVotes };
  if (opts.expectedVerifiers !== undefined) payload.expectedVerifiers = opts.expectedVerifiers;
  return payload;
}

// ---------------------------------------------------------------------------
// Agent failure classification
// ---------------------------------------------------------------------------

const UNIT_SECONDS = { h: 3600, m: 60, s: 1 };

/** "try again in 27 hours" -> seconds; `null` when the message names no duration. */
function retryAfterFromMessage(message) {
  const match = /(?:retry|try again)[^0-9]{0,24}(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?|h|m|s)\b/i.exec(message);
  if (match === null) return null;
  return Number(match[1]) * UNIT_SECONDS[match[2][0].toLowerCase()];
}

function failureAnswer(fields) {
  return { ok: true, retry: false, delayMs: 0, fallbackRoute: false, failFast: false, warnings: [], ...fields };
}

/**
 * What to do about one failed agent API call. A retry is advised only when it can still finish inside the agent's
 * deadline (see `deadlineAt` and `now` below).
 *
 * @param {Object} input
 * @param {number|string} [input.status]       HTTP status of the failure.
 * @param {number|string} [input.retryAfterSec] The server's retry-after, in seconds.
 * @param {string} [input.message]             The error text; consulted for the kind and, when
 *   `retryAfterSec` is absent, for a duration ("try again in 27 hours").
 * @param {number} [input.attempt]             Retries already made (default 0); `3` is exhausted.
 * @param {number} [input.failFastAfterSec]    A wait longer than this fails fast (default 300).
 * @param {number} [input.waitedSec]           Seconds already spent waiting on earlier retries of this agent (default 0);
 *   `waitedSec` plus this wait may not exceed `failFastAfterSec` either (`total-wait-too-long`).
 * @param {number|string} [input.deadlineAt]   The agent's deadline (epoch ms or ISO). With it, a wait that would end
 *   at or after the deadline fails fast (`retry-would-pass-deadline`); without it the retry is bounded only by
 *   `failFastAfterSec` and the attempt count, and the answer carries the warning `no-deadline-given`.
 * @param {number|string} [input.now]          The current time; required with `deadlineAt`. It already contains the
 *   earlier waits, so the total time spent waiting cannot run past the deadline.
 * @returns {{ok:boolean, kind:string, retry:boolean, delayMs:number, fallbackRoute:boolean, failFast:boolean,
 *   state:'retry'|'partial', reason:string, warnings:string[]}}
 *   `state: 'partial'` is the state to RECORD: the agent's slice or candidates are not reviewed.
 */
function classifyAgentFailure(input) {
  if (!isObject(input)) {
    return failureAnswer({ ok: false, kind: 'unknown', failFast: true, state: 'partial', reason: 'invalid-input' });
  }
  const warnings = [];
  const message = typeof input.message === 'string' ? input.message : '';

  const statusNumber = typeof input.status === 'string' && /^\d{3}$/.test(input.status.trim()) ? Number(input.status) : input.status;
  const status = Number.isInteger(statusNumber) && statusNumber >= 100 && statusNumber <= 599 ? statusNumber : null;

  let kind;
  if (status === 429) kind = 'rate-limit';
  else if (status === 529 || status === 503) kind = 'overloaded';
  else if (status === 408) kind = 'timeout';
  else if (status !== null && status >= 500) kind = 'server-error';
  else if (status !== null && status >= 400) kind = 'client-error';
  else if (/\b429\b|rate[ -]?limit|too many requests|quota/i.test(message)) kind = 'rate-limit';
  else if (/overload|\b529\b|at capacity/i.test(message)) kind = 'overloaded';
  else if (/timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(message)) kind = 'timeout';
  else kind = 'unknown';

  const attempt = input.attempt === undefined ? 0 : input.attempt;
  if (!Number.isInteger(attempt) || attempt < 0) {
    return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'invalid-attempt', warnings });
  }
  const failFastAfterSec = input.failFastAfterSec === undefined ? DEFAULT_FAIL_FAST_AFTER_SEC : input.failFastAfterSec;
  if (!Number.isFinite(failFastAfterSec) || failFastAfterSec < 0) {
    return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'invalid-failFastAfterSec', warnings });
  }
  const waitedSec = input.waitedSec === undefined ? 0 : input.waitedSec;
  if (!Number.isFinite(waitedSec) || waitedSec < 0) {
    return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'invalid-waitedSec', warnings });
  }

  if (kind === 'client-error' || kind === 'unknown') {
    // Nothing a retry changes (a 401, a 400) or nothing this module can read: record it, do not loop.
    return failureAnswer({
      kind,
      failFast: true,
      state: 'partial',
      reason: kind === 'client-error' ? `client-error-${status}` : 'unclassified-failure',
      warnings,
    });
  }

  // The agent's own deadline bounds every retry. An unreadable one fails closed rather than lifting the bound.
  let deadlineAt = null;
  let now = null;
  if (input.deadlineAt !== undefined && input.deadlineAt !== null) {
    deadlineAt = toMillis(input.deadlineAt);
    if (deadlineAt === null) return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'invalid-deadlineAt', warnings });
    now = toMillis(input.now);
    if (now === null) return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'invalid-now', warnings });
  }

  // Retry-after: the explicit field wins over a duration found in the text. A value that is not a
  // number of seconds is ignored with a warning; `Infinity` is a wait with no end and fails fast.
  let retryAfterSec = null;
  if (input.retryAfterSec !== undefined && input.retryAfterSec !== null) {
    const raw = typeof input.retryAfterSec === 'string' && input.retryAfterSec.trim() !== '' ? Number(input.retryAfterSec) : input.retryAfterSec;
    if (typeof raw === 'number' && !Number.isNaN(raw) && raw >= 0) retryAfterSec = raw;
    else warnings.push('unreadable-retry-after');
  }
  if (retryAfterSec === null) retryAfterSec = retryAfterFromMessage(message);

  if (attempt >= RETRY_MAX_ATTEMPTS) {
    return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'retries-exhausted', warnings });
  }
  if (retryAfterSec !== null && retryAfterSec > failFastAfterSec) {
    return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'retry-after-too-long', warnings });
  }

  const backoffMs = (kind === 'rate-limit' || kind === 'overloaded' ? RATE_LIMIT_BACKOFF_MS : TRANSIENT_BACKOFF_MS) * 2 ** attempt;
  const delayMs = retryAfterSec !== null ? Math.round(retryAfterSec * 1000) : backoffMs;
  if (waitedSec + delayMs / 1000 > failFastAfterSec) {
    return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'total-wait-too-long', warnings });
  }
  if (deadlineAt === null) {
    warnings.push('no-deadline-given');
  } else if (now >= deadlineAt) {
    return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'deadline-passed', warnings });
  } else if (now + delayMs >= deadlineAt) {
    // The retry would resume with no time left, or after the agent was already stopped.
    return failureAnswer({ kind, failFast: true, state: 'partial', reason: 'retry-would-pass-deadline', warnings });
  }
  return failureAnswer({
    kind,
    retry: true,
    delayMs,
    // A limit on one model route does not bind the alternate one; a plain timeout says nothing about the route.
    fallbackRoute: kind === 'rate-limit' || kind === 'overloaded',
    state: 'retry',
    reason: retryAfterSec !== null ? 'retry-after' : 'backoff',
    warnings,
  });
}

module.exports = {
  reviewDeadlines,
  floorOverrideMessage,
  collectResults,
  toVotesInput,
  classifyAgentFailure,
  defaultDeps,
  defaultScratchDir,
  DEADLINE_ROLES,
  MAX_RESULT_BYTES,
  RETRY_MAX_ATTEMPTS,
  DEFAULT_FAIL_FAST_AFTER_SEC,
};
