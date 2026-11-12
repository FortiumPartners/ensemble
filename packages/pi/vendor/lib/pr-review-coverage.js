'use strict';

/**
 * Review COVERAGE as a graded fact (kata k48x, epic ptqb): which changed paths nobody read, how that is recorded, how the
 * merge gate and the status grader read it, and how it crosses heads.
 *
 * NO side effects, NO shell, NO network, NO file reads, NO clock. Pure functions over plain JSON, like the rest of the
 * pr-review-* libraries.
 *
 * WHY IT EXISTS. `pr-review-run.js` has always KNOWN when a slice, the whole-range reader or a path went unread
 * (`coverage.complete`, `notReviewed`), and only REPORTED it: the gate took no coverage input and `deriveStatus` was given
 * none, so a run whose only reviewer expired could reach `LOCAL_REVIEW_COMPLETE` and `mergeable: true`. The plan's hard
 * constraint is that a path nobody reviewed is reported as not reviewed and never silently counted; this module is how the
 * gate and the status grader COUNT it.
 *
 * THE RECORD (`{ status, gaps[], reason? }`), the sibling of the security lane's `{ status, findings[], reason? }`:
 *
 *   status 'complete'     every changed path was read as the plan required; `gaps` is empty
 *          'incomplete'   `gaps` names what was not read
 *          'unavailable'  the coverage could not be computed (`reason` says why): nothing is known, so nothing is covered
 *
 * A GAP is shaped like a ledger finding (the fields `validateLedger` requires, `kind: 'coverage-gap'`,
 * `source: 'review-coverage'`) so the operator's decision on it travels the path every other decision travels: the
 * disposition list shows it, `ledger resolve` stamps `{ decision, reason, by, at, headSha }` on it, and the gate honours that exactly
 * as it honours one on an Important or security finding (`resolutionProvenanceProblem`). It is NOT a ledger entry: it lives
 * in the record (the state report's `coverage`), as the security lane's findings live in `security`, so verification, the
 * ledger's dedupe and repeat suppression, the carry candidates and the fix run never treat it as a finding about the code.
 *
 *   gapType 'slice'           a planned slice whose reviewers did not all arrive and list every path (`sliceId`, `paths`)
 *           'whole-range'     the whole-range reader of a light run cut into several slices, when one was planned and
 *                             did not arrive or did not list every changed path
 *           'uncovered'       changed paths no planned slice held and nobody read
 *           'under-reviewed'  paths read under fewer distinct lenses than the mode requires
 *           'result-changed'  a result file the review read and its agent rewrote afterwards (kata 271n): the review counted the
 *                             first version, so a finding or a vote that only the later one holds is not counted. One gap per agent
 *                             (`coverage:result-changed:<agent>`, with the agent in `sliceId`), `paths` the paths that result is about
 *           'unnamed'         the caller said "incomplete" and named nothing: every changed path is treated as unread
 *
 * WHAT COUNTS AS INCOMPLETE is decided where the facts are known (the runner, `slices`); this module only carries and
 * grades what it is handed. What is deliberately NOT coverage, because something else already stops it: an unverified or
 * unbriefable finding stays in the ledger and blocks by its severity, and a security lane that did not run or did not cover
 * every path blocks through `security` (`security-review-missing`, `review-data-unavailable`). A whole-range reader the plan
 * did not hold (`reader-not-planned`: the concurrency cap could not seat it) is a reported limit of the plan, not a path
 * nobody read.
 *
 * GRADING (`gradeCoverage`) fails closed. A record that is not an object, whose status is not one of the three, that says
 * `unavailable`, that says `complete` and lists gaps, that says `incomplete` and names none, or whose gaps are not
 * finding-shaped, with a duplicate id or with no path is UNREADABLE: the caller reports it as missing data, never as a pass.
 * A gap stays OPEN until it carries a `resolution` with provenance (a `decision` of exactly `accept` -- `follow-on` cannot unblock the gate -- a reason, a login the policy lets decide, an ISO-8601
 * timestamp with a zone, and a `headSha` equal to the head asked about). `cleared`, `blocking:false` and a deferral decide
 * nothing here. HONEST LIMIT, the same as every decision in this cycle: that proves a reason is present, a login is named and
 * the head is bound; it cannot prove a human typed it.
 *
 * CARRY (`carryCoverage`). Coverage belongs to the head it was computed at, and a state report is discarded for any other head
 * (`readState`). A review round that reads only a DELTA says nothing about the paths it did not read, so a delta round carries
 * every gap of the round it starts from (re-stamped `carriedFrom`, its old decision left on it to be found stale at the new
 * head) and a round of the full range carries none. A carried verdict is a verification fact about a finding; it is never a
 * claim that anyone read a path.
 */

const { validateLedger, resolutionProvenanceProblem } = require('./pr-review-ledger');

const COVERAGE_STATUSES = Object.freeze(['complete', 'incomplete', 'unavailable']);
const GAP_KIND = 'coverage-gap';
const GAP_SOURCE = 'review-coverage';
const GAP_TYPES = Object.freeze(['slice', 'whole-range', 'uncovered', 'under-reviewed', 'result-changed', 'unnamed']);
/** The named outcome of a result file that holds other bytes than the review read (kata 271n), as the runner records it. */
const RESULT_CHANGED = 'result-changed-after-read';
/** The id the whole-range reader's coverage is kept under (never one of the plan's slices). */
const WHOLE_RANGE_ID = 'whole-range';
/** How many paths a gap's one-line text names before it says how many more there are (the full list is in `paths`). */
const LISTED_PATHS = 8;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const texts = (list) => (Array.isArray(list) ? list.filter(isText).map((entry) => entry.trim()) : []);
const unique = (list) => [...new Set(list)];

/** `a, b, c` for the first few paths, then `and N more`. */
function listPaths(paths, max = LISTED_PATHS) {
  const shown = paths.slice(0, max).join(', ');
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** `212 bytes, sha256 1a2b3c4d5e6f`: the fingerprint of a result file as a person reads it, or `not readable`. */
const printOf = (print) => (isObject(print) && Number.isFinite(print.size) && isText(print.sha256) ? `${print.size} bytes, sha256 ${print.sha256.slice(0, 12)}` : 'not readable');

/** Why a changed result was not counted, from the runner's `detail` of it (kata 271n). */
function changeWhy(detail) {
  if (detail === 'rewritten-after-use') return 'the later version was never read: the results of its round had already been used';
  if (detail === 'rewritten-after-deadline') return "the later version arrived after the agent's deadline, so it is never read";
  if (detail.startsWith('rewritten-unusable:')) return `the later version cannot be used: ${detail.slice('rewritten-unusable:'.length)}`;
  if (detail.startsWith('replaced:')) return `it is no regular file any more: ${detail.slice('replaced:'.length)}`;
  if (detail.startsWith('unreadable:')) return `it cannot be read now: ${detail.slice('unreadable:'.length)}`;
  return detail;
}

/** `reviewer-s2-a: expired:deadline-passed; reviewer-s2-b: paths-not-reviewed`, or '' when nothing is known. */
function reasonsText(reasons) {
  return reasons.map((entry) => `${entry.agent}: ${entry.reason}`).join('; ');
}

function readReasons(detail) {
  if (!isObject(detail) || !Array.isArray(detail.reasons)) return [];
  return detail.reasons
    .filter((entry) => isObject(entry) && isText(entry.reason))
    .map((entry) => ({ agent: isText(entry.agent) ? entry.agent.trim() : 'an agent', reason: entry.reason.trim() }));
}

/** One gap: every field a ledger finding must carry, plus what a person needs to decide it. */
function makeGap({ id, gapType, sliceId, paths, missingPaths, reasons, locationOrLink, failureMode, evidence, origin }) {
  return {
    id,
    kind: GAP_KIND,
    gapType,
    source: GAP_SOURCE,
    severity: 'important',
    disposition: 'adjudicate',
    ...(sliceId === undefined ? {} : { sliceId }),
    paths,
    ...(missingPaths !== undefined && missingPaths.length > 0 ? { missingPaths } : {}),
    reasons,
    locationOrLink,
    failureMode,
    evidence,
    originalTextOrLink: origin,
  };
}

function unavailableRecord(reason) {
  return { status: 'unavailable', gaps: [], reason };
}

/**
 * Builds the coverage record from what a review round knows.
 *
 * @param {Object}   input
 * @param {string[]} input.changedPaths     Every path of the range under review.
 * @param {Array<{id:string, paths:string[]}>} input.slices  The planned slices (a gap names its paths from here).
 * @param {string[]} [input.unreviewedSlices] Slice ids no reviewer covered; `whole-range` is the reader's.
 * @param {string[]} [input.uncovered]      Paths nobody read (an unreviewed slice's paths among them).
 * @param {Array<{path:string, lenses?:string[]}>} [input.underReviewed] Paths read under too few distinct lenses.
 * @param {number}   [input.requiredLenses] How many distinct lenses a path needs (for the message).
 * @param {Array<{sliceId:string, reasons?:Array<{agent:string, reason:string}>, missingPaths?:string[]}>} [input.detail]
 *   Why each unreviewed slice (and the reader) failed, from the result collector. Absent: the reason is not known.
 * @param {boolean}  [input.incomplete]     The caller's own `complete: false`, so a record that names nothing still cannot be read as complete.
 * @param {Object[]} [input.changedResults] Result files that changed after the review read them (kata 271n), one entry per agent:
 *   `{agent, role?, round?, detail?, paths[], read?, now?, file?}`. Each is a `result-changed` gap (`coverage:result-changed:<agent>`).
 * @param {string}   [input.unavailable]    Why the coverage could not be computed at all.
 * @param {string}   [input.origin]         Where the reads were collected (for example the run id); default `review coverage`.
 * @returns {{status:string, gaps:Object[], reason?:string}}
 */
function buildCoverage(input) {
  if (!isObject(input)) return unavailableRecord('the coverage input is not an object');
  if (input.unavailable !== undefined && input.unavailable !== null) {
    return unavailableRecord(
      `the coverage could not be computed${isText(input.unavailable) ? ` (${input.unavailable.trim()})` : ''}, so every changed path is treated as not reviewed`
    );
  }
  if (!Array.isArray(input.changedPaths) || !input.changedPaths.every(isText) || !Array.isArray(input.slices)) {
    return unavailableRecord('the changed paths or the slice plan could not be read, so every changed path is treated as not reviewed');
  }
  const changed = unique(input.changedPaths.map((entry) => entry.trim()));
  const origin = isText(input.origin) ? input.origin.trim() : 'review coverage';
  const detailOf = new Map((Array.isArray(input.detail) ? input.detail : []).filter((entry) => isObject(entry) && isText(entry.sliceId)).map((entry) => [entry.sliceId.trim(), entry]));
  const planned = new Map();
  for (const slice of input.slices) {
    if (!isObject(slice) || !isText(slice.id) || !Array.isArray(slice.paths)) {
      return unavailableRecord('a planned slice could not be read, so every changed path is treated as not reviewed');
    }
    planned.set(slice.id.trim(), texts(slice.paths));
  }

  const gaps = [];
  const inSlice = new Set();
  for (const paths of planned.values()) for (const path of paths) inSlice.add(path);

  // a slice is reviewed only when every reviewer of it arrived and listed every path: one that did not leaves the whole slice unread
  for (const id of unique(texts(input.unreviewedSlices))) {
    if (id === WHOLE_RANGE_ID) continue;
    const detail = detailOf.get(id);
    const held = planned.has(id) ? planned.get(id) : texts(detail === undefined ? [] : detail.missingPaths);
    // a slice the plan does not hold (a caller's id) names every changed path: unread is never narrowed to what could be named
    const paths = held.length > 0 ? held : changed;
    const reasons = readReasons(detail);
    const missingPaths = texts(detail === undefined ? [] : detail.missingPaths);
    const why = reasons.length > 0 ? `; ${reasonsText(reasons)}` : '; no reviewer result covered it';
    gaps.push(
      makeGap({
        id: `coverage:slice:${id}`,
        gapType: 'slice',
        sliceId: id,
        paths,
        missingPaths,
        reasons,
        locationOrLink: `slice ${id}: ${listPaths(paths, 3)}`,
        failureMode: `NOT REVIEWED: slice ${id} (${plural(paths.length, 'path')}: ${listPaths(paths)})${why}`,
        evidence: `a slice counts as reviewed only when every reviewer of it arrived in time and listed every path of it${missingPaths.length > 0 ? `; not listed: ${listPaths(missingPaths)}` : ''}`,
        origin,
      })
    );
  }

  // the whole-range reader of a light run cut into several slices: planned, and it did not arrive or did not list every changed path
  if (texts(input.unreviewedSlices).includes(WHOLE_RANGE_ID)) {
    const detail = detailOf.get(WHOLE_RANGE_ID);
    const reasons = readReasons(detail);
    const missingPaths = texts(detail === undefined ? [] : detail.missingPaths);
    gaps.push(
      makeGap({
        id: `coverage:${WHOLE_RANGE_ID}`,
        gapType: 'whole-range',
        sliceId: WHOLE_RANGE_ID,
        paths: changed,
        missingPaths,
        reasons,
        locationOrLink: `whole-range read: ${plural(changed.length, 'changed path')}`,
        failureMode: `NOT REVIEWED: the whole-range read of ${plural(changed.length, 'changed path')} (the one reader of an interaction between slices)${reasons.length > 0 ? `; ${reasonsText(reasons)}` : '; no reviewer result covered it'}${missingPaths.length > 0 ? `; paths it did not list: ${listPaths(missingPaths)}` : ''}`,
        evidence: 'the whole-range reader was planned for this run and its read is missing or short, so no reader saw the whole diff at once',
        origin,
      })
    );
  }

  // changed paths no planned slice held and nobody read
  const stray = unique([...texts(input.uncovered), ...changed.filter((path) => !inSlice.has(path))]).filter((path) => !inSlice.has(path));
  if (stray.length > 0) {
    gaps.push(
      makeGap({
        id: 'coverage:uncovered',
        gapType: 'uncovered',
        paths: stray,
        reasons: [],
        locationOrLink: `no slice held: ${listPaths(stray, 3)}`,
        failureMode: `NOT REVIEWED: ${plural(stray.length, 'changed path')} no slice held and no reviewer read (${listPaths(stray)})`,
        evidence: 'the slice plan was cut from a path list that does not contain these changed paths',
        origin,
      })
    );
  }

  // paths read under fewer distinct lenses than the mode requires; a path nobody read at all is already named by its slice or stray gap
  const unread = new Set(gaps.filter((gap) => gap.gapType === 'slice' || gap.gapType === 'uncovered').flatMap((gap) => gap.paths));
  const under = (Array.isArray(input.underReviewed) ? input.underReviewed : []).filter((entry) => isObject(entry) && isText(entry.path) && !unread.has(entry.path.trim()));
  if (under.length > 0) {
    const required = Number.isInteger(input.requiredLenses) && input.requiredLenses > 0 ? input.requiredLenses : null;
    const paths = unique(under.map((entry) => entry.path.trim()));
    const noLens = unique(under.filter((entry) => texts(entry.lenses).length === 0).map((entry) => entry.path.trim()));
    gaps.push(
      makeGap({
        id: 'coverage:under-reviewed',
        gapType: 'under-reviewed',
        paths,
        reasons: [],
        locationOrLink: `under-reviewed: ${listPaths(paths, 3)}`,
        failureMode: `NOT REVIEWED under every required lens: ${plural(paths.length, 'path')} (${listPaths(paths)}) ${paths.length === 1 ? 'was' : 'were'} read under fewer distinct lenses than ${required === null ? 'the mode requires' : `the ${required} the mode requires`}${noLens.length > 0 ? `; no reviewer named ${plural(noLens.length, 'path')} (${listPaths(noLens)}), so nobody read ${noLens.length === 1 ? 'it' : 'them'}` : ''}`,
        evidence: under.slice(0, LISTED_PATHS).map((entry) => `${entry.path.trim()}: ${texts(entry.lenses).join('+') || 'no lens'}`).join('; '),
        origin,
      })
    );
  }

  // a result file the review read and its agent rewrote afterwards (kata 271n): the review counted the first version, so whatever only the
  // later one holds (a finding, a vote) is not counted. One gap per agent, decided like any other: the operator's recorded decision on
  // this head, or a new run. An entry the record cannot read is never skipped: nothing is then known to be covered.
  const seenAgents = new Set();
  for (const change of Array.isArray(input.changedResults) ? input.changedResults : []) {
    if (!isObject(change) || !isText(change.agent) || seenAgents.has(change.agent.trim())) {
      return unavailableRecord('a changed result could not be read, so every changed path is treated as not reviewed');
    }
    const agent = change.agent.trim();
    seenAgents.add(agent);
    const held = texts(change.paths);
    const paths = held.length > 0 ? held : changed;
    const who = `${agent}${isText(change.role) ? ` (${change.role.trim()})` : ''}`;
    gaps.push(
      makeGap({
        id: `coverage:result-changed:${agent}`,
        gapType: 'result-changed',
        sliceId: agent,
        paths,
        reasons: [{ agent, reason: RESULT_CHANGED }],
        locationOrLink: `result of ${agent}: ${listPaths(paths, 3)}`,
        failureMode: `RESULT CHANGED AFTER READ: the result file of ${who} holds other bytes now than the review read (first read: ${printOf(change.read)}; now: ${printOf(change.now)}), so the review counted the first version and a finding or a vote that only the later one holds is not counted${isText(change.detail) ? ` (${changeWhy(change.detail.trim())})` : ''}; it concerns ${plural(paths.length, 'path')} (${listPaths(paths)})${isText(change.file) ? `; read the file before deciding: ${change.file.trim()}` : ''}`,
        evidence: `the agent rewrote its result after the runner read it${isText(change.file) ? `: ${change.file.trim()}` : ''}; a result is read once its round is used and a later version is never read, so the dispatcher collected before the agent had finished, or the agent kept writing`,
        origin,
      })
    );
  }

  // the caller says incomplete and names nothing: never complete
  if (gaps.length === 0 && input.incomplete === true) {
    gaps.push(
      makeGap({
        id: 'coverage:unnamed',
        gapType: 'unnamed',
        paths: changed,
        reasons: [],
        locationOrLink: `every changed path: ${plural(changed.length, 'path')}`,
        failureMode: `NOT REVIEWED: the review reports incomplete coverage and names no slice or path, so every changed path (${plural(changed.length, 'path')}) is treated as not reviewed`,
        evidence: 'an incomplete coverage that names nothing cannot be read as complete',
        origin,
      })
    );
  }

  return gaps.length === 0 ? { status: 'complete', gaps: [] } : { status: 'incomplete', gaps };
}

/** The keys a coverage record has; any other key means it was written by hand or merged from another answer. */
const RECORD_KEYS = ['status', 'gaps', 'reason'];

/** What a gap must carry to be read at all: the finding fields, its own kind and source, and at least one path. */
function gapShapeProblem(gap) {
  if (!isObject(gap)) return 'not an object';
  if (gap.kind !== GAP_KIND || gap.source !== GAP_SOURCE) return 'not a coverage gap';
  if (!Array.isArray(gap.paths) || gap.paths.length === 0 || !gap.paths.every(isText)) return 'it names no path';
  return null;
}

/**
 * Grades a coverage record against the head the gate or the status is asked about.
 *
 * @param {*} record
 * @param {{headSha?:string, policy?:Object}} [context]  `policy`: the policy block, to check who may decide a gap.
 * @returns {{status:string|null, open:Array<{gap:Object, rejectedBecause:string|null}>,
 *   decided:Array<{gap:Object, reason:string, by:string, at:string}>, missing:string[], reason:string|null, settled:boolean}}
 *   `missing` is what could not be READ (the caller answers it as unavailable data, never as a pass); `open` the gaps still
 *   undecided; `settled` is true only when nothing is missing and nothing is open.
 */
function gradeCoverage(record, context = {}) {
  const out = { status: null, open: [], decided: [], missing: [], reason: null, settled: false };
  if (!isObject(record)) {
    out.missing.push('the coverage record');
    return out;
  }
  // The contract is exactly { status, gaps, reason? }. A key outside it (a `complete` flag, an `unreviewedSlices` list) means the
  // record was written by hand or merged from another answer: it is refused, never read as saying anything.
  const extra = Object.keys(record).filter((key) => !RECORD_KEYS.includes(key));
  if (extra.length > 0) {
    out.missing.push(`the coverage record (it carries keys outside its contract: ${extra.sort().join(', ')})`);
    return out;
  }
  const status = isText(record.status) ? record.status.trim().toLowerCase() : null;
  if (status === null || !COVERAGE_STATUSES.includes(status)) {
    out.missing.push('the coverage status');
    return out;
  }
  if (status !== 'unavailable' && !Array.isArray(record.gaps)) {
    out.missing.push('the coverage gaps (a complete or incomplete record carries a gaps array, empty when complete)');
    return out;
  }
  out.status = status;
  if (status === 'unavailable') {
    out.reason = isText(record.reason) ? record.reason.trim() : null;
    out.missing.push(`the coverage result${out.reason === null ? '' : `: ${out.reason}`}`);
    return out;
  }
  const { gaps } = record;
  if (status === 'complete') {
    if (gaps.length > 0) out.missing.push('the coverage record (it says complete and lists gaps)');
    out.settled = out.missing.length === 0;
    return out;
  }
  if (gaps.length === 0) {
    out.missing.push('the coverage gaps it reported (it says incomplete and names none)');
    return out;
  }
  const validation = validateLedger(gaps);
  const bad = gaps.filter((gap) => gapShapeProblem(gap) !== null);
  const ids = gaps.filter(isObject).map((gap) => String(gap.id));
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (validation.ok !== true || bad.length > 0 || duplicates.length > 0) {
    const named = unique([...validation.offendingIds, ...bad.map((gap) => (isObject(gap) ? gap.id : null)), ...duplicates]).map((id) => (id === null || id === undefined ? 'unidentified' : String(id)));
    const problems = bad.map((gap) => `${isObject(gap) && gap.id !== undefined ? String(gap.id) : 'unidentified'}: ${gapShapeProblem(gap)}`);
    out.missing.push(`unusable coverage gaps (${named.join(', ') || 'unreadable'})${problems.length > 0 ? `: ${problems.join('; ')}` : ''}`);
    return out;
  }
  for (const gap of gaps) {
    const problem = resolutionProvenanceProblem(gap, context.headSha, context.policy);
    if (problem === null) {
      const { reason, by, at } = gap.resolution;
      out.decided.push({ gap, reason: reason.trim(), by: by.trim(), at: at.trim() });
    } else {
      out.open.push({ gap, rejectedBecause: isObject(gap.resolution) ? problem : null });
    }
  }
  out.settled = out.open.length === 0;
  return out;
}

/** One line naming the open gaps, for a status reason or a notice. */
function summarizeOpen(open) {
  return open
    .map(({ gap }) => (gap.gapType === 'slice' ? `slice ${gap.sliceId} (${listPaths(gap.paths, 3)})` : gap.gapType === 'whole-range' ? 'the whole-range read' : gap.gapType === 'result-changed' ? `the result of ${gap.sliceId} changed after it was read` : `${gap.gapType}: ${listPaths(gap.paths, 3)}`))
    .join('; ');
}

/**
 * The coverage record of a review round that reads a DELTA, with every gap of the round it starts from carried in.
 *
 * @param {Object}  input
 * @param {Object}  input.current        This round's own record (what its reviewers read of the delta).
 * @param {*}       input.prior          The record the state report of the round the delta starts from holds, or null when it was not read.
 * @param {string}  [input.priorState]   `read` or why nothing was read (`absent`, `discarded`, `corrupt`, `unreadable`).
 * @param {string}  input.priorHeadSha   The head the delta starts from (`lastReviewedSha`).
 * @param {boolean} input.fullRange      True when this round read the whole range: nothing of an earlier round is needed.
 * @returns {{ok:boolean, carried:string[], reasons:string[], coverage:Object}}
 *   `coverage` is the record to hand to `status` and `gate`. It is `incomplete` while any gap of the earlier round stands, and
 *   `unavailable` when the earlier round's coverage cannot be read: a delta says nothing about the paths it did not read.
 */
function carryCoverageOf(input) {
  const current = isObject(input) ? input.current : undefined;
  if (!isObject(current)) return { ok: false, carried: [], reasons: ['this round\'s coverage record is not an object'], coverage: unavailableRecord('this round\'s coverage record could not be read') };
  if (input.fullRange === true) return { ok: true, carried: [], reasons: ['range-full'], coverage: current };

  const priorState = isText(input.priorState) ? input.priorState.trim() : input.prior === null || input.prior === undefined ? 'unreadable' : 'read';
  if (priorState !== 'read') {
    const why = `prior-state-unavailable (${priorState})`;
    return { ok: false, carried: [], reasons: [why], coverage: unavailableRecord(`this round read a delta and the coverage of the round it starts from cannot be read: ${why}, so what the delta did not read is unknown`) };
  }
  const graded = gradeCoverage(input.prior, {});
  if (graded.status === 'complete' && graded.missing.length === 0) {
    return { ok: true, carried: [], reasons: ['prior-coverage-complete'], coverage: current };
  }
  if (graded.status !== 'incomplete' || graded.missing.length > 0) {
    const why = `prior-coverage-unavailable (${graded.missing.join('; ') || 'unreadable'})`;
    return { ok: false, carried: [], reasons: [why], coverage: unavailableRecord(`this round read a delta and the coverage of the round it starts from cannot be read: ${why}, so what the delta did not read is unknown`) };
  }

  const priorHead = isText(input.priorHeadSha) ? input.priorHeadSha.trim() : null;
  const taken = new Set(isObject(current) && Array.isArray(current.gaps) ? current.gaps.filter(isObject).map((gap) => String(gap.id)) : []);
  const carriedGaps = [];
  for (const gap of input.prior.gaps) {
    const id = taken.has(String(gap.id)) ? `${gap.id}@${(priorHead || 'earlier').slice(0, 7)}` : String(gap.id);
    taken.add(id);
    carriedGaps.push({ ...gap, id, carriedFrom: isText(gap.carriedFrom) ? gap.carriedFrom : priorHead || 'an earlier head' });
  }
  const own = Array.isArray(current.gaps) ? current.gaps : [];
  const status = current.status === 'unavailable' ? 'unavailable' : 'incomplete';
  const coverage = { ...current, status, gaps: [...own, ...carriedGaps] };
  return { ok: true, carried: carriedGaps.map((gap) => gap.id), reasons: ['prior-coverage-incomplete'], coverage };
}

/** What a delta round over an unreadable earlier record is told to do: only the full range replaces an unknown with a record. */
const FULL_RANGE_WAY_OUT = 'run this round over the FULL range (deltaPlan.mode "full"): its reviewers read every path themselves and its own record replaces the earlier one';

function carryCoverage(input) {
  const answer = carryCoverageOf(input);
  if (answer.ok === true || !answer.reasons.some((reason) => reason.startsWith('prior-'))) return answer;
  // A delta over a report with no readable coverage (every report written before the coverage existed) stays unavailable, and so does
  // every delta round after it: the answer says what clears it instead of leaving the orchestrator to guess.
  return { ...answer, fullRangeRequired: true, coverage: unavailableRecord(`${answer.coverage.reason}; ${FULL_RANGE_WAY_OUT}`) };
}

module.exports = {
  buildCoverage,
  gradeCoverage,
  carryCoverage,
  summarizeOpen,
  COVERAGE_STATUSES,
  GAP_KIND,
  GAP_SOURCE,
  GAP_TYPES,
  WHOLE_RANGE_ID,
};
