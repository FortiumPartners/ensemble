'use strict';

/**
 * The merge gate: the one place that answers "may this PR merge?".
 *
 * NO side effects, NO shell, NO network calls. Every input is already
 * gathered by the caller (`pr-review-cycle` through `pr-review-cli.js gate`);
 * this module only grades what it was handed:
 *
 *   - the finding ledger            (pr-review-ledger.js)
 *   - the approvals result          (pr-review-approvals.js)
 *   - the effective tier            (pr-review-tier.js)
 *   - the PR description check      (pr-review-description.js)
 *   - the security lane's result    (the review's security pass)
 *   - the review's coverage         (pr-review-coverage.js: which changed paths nobody read)
 *
 * It is mergeable ONLY when no Important finding is open (including every open
 * security-lane finding), approvals are satisfied, no required description
 * section is missing and no changed path went unread (AC-008-1, AC-017-1,
 * AC-002-3, kata k48x). Nit and Pre-existing findings never block (AC-008-4).
 *
 * An INCOMPLETE COVERAGE blocks like an expired security lane does: a slice, the
 * whole-range reader or a path the review did not read is named in a
 * `review-coverage-incomplete` blocker and the review is not mergeable until the
 * review is run again, or the operator's recorded decision on the gap (the same
 * `resolution` with provenance as below, `ledger resolve`) accepts it. Coverage is
 * a REQUIRED input: one that is absent, unreadable or `unavailable` is
 * `review-data-unavailable`, never "nothing was missed". `cleared`, `blocking:false`
 * and a deferral decide nothing for a gap.
 *
 * An Important, unrecognised-severity or security-lane finding is closed only
 * by a later head that cleared it or by the operator's recorded decision: a
 * resolution with provenance -- a `decision` that is exactly `accept` (`follow-on` closes only a
 * finding that never blocked: a follow-on PR cannot unblock the gate), a reason, the login that
 * decided (one the policy lets decide), a timestamp and the head commit it was decided against,
 * equal to this gate's `headSha` (see `applyProvenance`). The review's own
 * deferral of a non-blocking Major, and a reason nobody put a decision, a login, a time
 * and a head to, close nothing. That is attribution and head-binding, not
 * authentication: it cannot show a human typed it.
 *
 * FAIL CLOSED, in both directions:
 *   - Missing, unreadable or unavailable review data is NEVER read as "nothing
 *     to answer". It is `review-data-unavailable`, `mergeable: false`, naming
 *     exactly what is missing (AC of TRD-025, 4th bullet). A gate that passes
 *     because `gh` was rate-limited is the failure this rule exists to prevent.
 *   - A finding whose severity cannot be read blocks: an unknown word is never
 *     demoted to Nit.
 *
 * Every blocker carries a `code`, a human `message` naming the finding or the
 * section, and a `nextAction` the author can actually take.
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-025
 */

const {
  validateLedger,
  partitionFindings,
  isActionable,
  isCritical,
  claimsStoppingRuleDeferral,
  normalizeSeverity,
  withoutRefusedResolution,
} = require('./pr-review-ledger');
const { gradeCoverage } = require('./pr-review-coverage');
const { TIERS, HUMANS_REQUIRED } = require('./pr-review-tier');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** The blocker vocabulary. Callers match on these, never on message text. */
const BLOCKER_CODES = Object.freeze({
  OPEN_IMPORTANT_FINDING: 'open-important-finding',
  OPEN_UNRECOGNISED_FINDING: 'open-unrecognised-finding',
  SECURITY_FINDING_OPEN: 'security-finding-open',
  SECURITY_REVIEW_MISSING: 'security-review-missing',
  APPROVALS_UNSATISFIED: 'approvals-unsatisfied',
  APPROVALS_TIER_MISMATCH: 'approvals-tier-mismatch',
  DESCRIPTION_SECTION_MISSING: 'description-section-missing',
  COVERAGE_INCOMPLETE: 'review-coverage-incomplete',
  REVIEW_DATA_UNAVAILABLE: 'review-data-unavailable',
});

/** The lane results this gate knows how to read. Anything else is unreadable. */
const SECURITY_STATUSES = Object.freeze(['clean', 'findings', 'not-run', 'unavailable']);

/** The tiers whose PRs may not merge without a security pass (AC-017-1). */
const SECURITY_REQUIRED_TIERS = Object.freeze(['medium', 'high']);

const NEXT_ACTION_DATA =
  're-run the review to collect it, grant the access it needs, or supply the input to the gate; the gate never passes on missing data';

function blocker(code, message, nextAction, extra = {}) {
  return { code, message, nextAction, ...extra };
}

/** The fail-closed answer when the payload itself cannot be read at all. */
function unreadable(missing) {
  return {
    ok: false,
    mergeable: false,
    blockers: [
      blocker(
        BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE,
        `the merge gate cannot read its input: ${missing.join(', ')}`,
        NEXT_ACTION_DATA,
        { missing: missing.slice() }
      ),
    ],
    warnings: [],
    findings: { important: 0, nits: 0, preExisting: 0, unrecognised: 0, open: [] },
    securityLane: { status: 'unavailable', open: [], cleared: [], resolved: [] },
    coverage: { status: 'unavailable', open: [], decided: [], unreadable: [] },
    approvals: null,
    tier: null,
    reasons: ['review-data-unavailable'],
  };
}

/** How a finding is named in a blocker: its id and the place it cites. */
function nameOf(finding) {
  const id = isText(finding.id) || Number.isFinite(finding.id) ? String(finding.id) : 'an unidentified finding';
  return isText(finding.locationOrLink) ? `${id} (${finding.locationOrLink.trim()})` : id;
}

/** The recorded resolution reason of a finding, or null when none was stated. */
function resolutionReason(finding) {
  return isObject(finding.resolution) && isText(finding.resolution.reason) ? finding.resolution.reason.trim() : null;
}

/**
 * Why the review's own deferral does not close an Important finding at the gate.
 * The stopping rule lets the triager mark a non-blocking Major `blocking: false`
 * and deferred with a `reason`; that is the review's classification, written by
 * the agent that made the finding, and needs no login, timestamp or head.
 */
const DEFERRAL_NOT_AN_ANSWER = "a deferral is the review's own classification (the stopping rule), not an operator's decision";

/**
 * Why a Critical's deferral closes nothing. For a Critical it is not the review's own classification that the gate chose not to
 * take: the stopping rule never defers a Critical, so there was no deferral to take. The blocker says that instead of calling a
 * deferral the stopping rule does not allow "the review's own classification".
 */
const CRITICAL_NEVER_DEFERRED = "a Critical is never deferrable: the stopping rule does not apply to it, and a deferral is not an operator's decision either";

/** The clause a blocker adds when the gate refused a closure that would have ended it: what did not count, and why. */
function refusalNote(rejectedBecause, deferralRejected) {
  const notes = [];
  if (rejectedBecause !== null) notes.push(`its recorded resolution does not count (${rejectedBecause})`);
  if (deferralRejected !== null) notes.push(`its deferral as non-blocking does not count (${deferralRejected})`);
  return notes.length === 0 ? '' : `: ${notes.join('; ')}`;
}

/**
 * The finding AS THE GATE READS IT. This is stricter than `isActionable` where
 * the finding needs the OPERATOR's answer: an Important or unrecognised-severity
 * ledger finding, and every security-lane entry whatever its severity (the lane
 * blocks while any entry is open). Of the closures an agent can write for
 * itself the gate takes none:
 *
 *   - a recorded resolution counts only with provenance: a `decision` (only `accept` closes a
 *     blocking finding: `follow-on` does not), a stated reason, the
 *     login that decided (`by`, one the policy lets decide), an ISO-8601
 *     timestamp (`at`) and the head commit it was decided against, equal to
 *     the head this gate is asked about (`resolutionProvenanceProblem`). One
 *     without it is IGNORED, not half-honoured: the returned entry has no
 *     resolution;
 *   - the stopping rule's deferral of a non-blocking Major (`blocking: false`,
 *     deferred, a `reason`) is the triager's word, so an Important finding is
 *     read without its `blocking` flag and grades as open. `isActionable`
 *     itself still reads the deferral: the review cycle's question is not the
 *     gate's. (It never reads one on a Critical, written as such or read into
 *     the taxonomy since: the stopping rule does not apply to a Critical, so
 *     the gate does not rest on the line above for it, and the blocker says so,
 *     `CRITICAL_NEVER_DEFERRED`.)
 *
 * What stays: `cleared: true` (a later head fixed it) is taken as written, and
 * an open thread or an uncertain flag outranks every closure, as in
 * `isActionable`. A Nit or Pre-existing LEDGER finding never needed an answer,
 * so nothing it carries is held to this.
 *
 * What this does NOT do: prove a human typed the decision. A named login on
 * the current head is attribution, not authentication.
 *
 * @param {Object} entry
 * @param {string|null} headSha The commit the gate is asked about.
 * @param {boolean} lane True for a security-lane entry.
 * @param {Object} [policy] The policy block, to check who may decide.
 * @returns {{entry:Object, rejectedBecause:string|null, deferralRejected:string|null}}
 *   `rejectedBecause` is set only when a resolution WAS recorded, would have
 *   closed the finding, and was refused (always, for a lane entry, so the
 *   blocker can say why it is still open); `deferralRejected` only when the
 *   deferral alone would have closed it, and was ignored, or when a Critical
 *   was written with a deferral (`CRITICAL_NEVER_DEFERRED`).
 */
function applyProvenance(entry, headSha, lane, policy) {
  const severity = normalizeSeverity(entry.severity);
  const needsOperator = lane || (severity !== 'pre-existing' && severity !== 'nit');
  if (!needsOperator || entry.cleared === true) return { entry, rejectedBecause: null, deferralRejected: null };

  const { resolution, ...withoutResolution } = entry;
  const withoutDeferral = (candidate) => {
    const { blocking, ...rest } = candidate;
    return rest;
  };
  const refusal = isObject(resolution) ? withoutRefusedResolution(entry, headSha, lane, policy).refusal : null;

  let reading = refusal === null ? entry : withoutResolution;
  if (severity === 'important') reading = withoutDeferral(reading);
  const stillOpen = isActionable(reading);

  const resolutionWouldHaveClosed = refusal !== null && !isActionable(severity === 'important' ? withoutDeferral(entry) : entry);
  const rejectedBecause = refusal !== null && (lane || (resolutionWouldHaveClosed && stillOpen)) ? refusal : null;
  const deferralWouldHaveClosed = !lane && severity === 'important' && entry.blocking !== undefined && !isActionable(withoutResolution);
  // `isActionable` never lets a deferral close a Critical, so `deferralWouldHaveClosed` is never true for one: a Critical written
  // with the stopping rule's deferral is named here, or its blocker would say nothing of the deferral at all.
  const criticalDeferred = !lane && severity === 'important' && isCritical(entry) && claimsStoppingRuleDeferral(entry);
  let deferralRejected = null;
  if (stillOpen && criticalDeferred) deferralRejected = CRITICAL_NEVER_DEFERRED;
  else if (stillOpen && deferralWouldHaveClosed) deferralRejected = DEFERRAL_NOT_AN_ANSWER;
  return { entry: reading, rejectedBecause, deferralRejected };
}

/**
 * The effective tier the gate grades against: the tier result's word when it
 * is readable, else the one the approvals result already resolved.
 * `null` means neither could be read.
 */
function readTier(tierResult, approvalsResult) {
  const fromTier = isObject(tierResult) && tierResult.ok !== false ? tierResult.effectiveTier : null;
  const candidate = isText(fromTier) ? fromTier : isObject(approvalsResult) ? approvalsResult.tier : null;
  if (!isText(candidate)) return null;
  const word = candidate.trim().toLowerCase();
  return TIERS.includes(word) ? word : null;
}

/**
 * Grade the security lane. Returns the lane record plus the blockers it adds.
 * An open lane finding blocks; one closed by the operator's recorded decision
 * (a resolution with provenance) is recorded and stops blocking (AC-017-3);
 * one a later head fixed clears on its own (AC-017-2); a lane that never ran
 * blocks Medium and High (AC-017-1).
 */
function gradeSecurityLane(lane, tier, headSha, policy) {
  const record = { status: 'unavailable', open: [], cleared: [], resolved: [] };
  const blockers = [];
  const warnings = [];

  const status = isText(lane.status) ? lane.status.trim().toLowerCase() : null;
  if (status === null || !SECURITY_STATUSES.includes(status)) {
    return { record, blockers, warnings, missing: ['security lane status'] };
  }
  record.status = status;

  if (status === 'unavailable') {
    const why = isText(lane.reason) ? `: ${lane.reason.trim()}` : '';
    return { record, blockers, warnings, missing: [`the security lane result${why}`] };
  }

  if (status === 'not-run') {
    if (tier !== null && SECURITY_REQUIRED_TIERS.includes(tier)) {
      blockers.push(
        blocker(
          BLOCKER_CODES.SECURITY_REVIEW_MISSING,
          `the security review did not run and this PR is ${tier} tier`,
          'run the security lane of pr-review-cycle on the current head, then re-run the gate',
          { tier }
        )
      );
    } else {
      warnings.push('security-review-not-run');
    }
    return { record, blockers, warnings, missing: [] };
  }

  const findings = lane.findings === undefined || lane.findings === null ? [] : lane.findings;
  if (!Array.isArray(findings)) return { record, blockers, warnings, missing: ['security lane findings'] };
  if (status === 'findings' && findings.length === 0) {
    return { record, blockers, warnings, missing: ['the security lane findings it reported'] };
  }

  const validation = validateLedger(findings);
  if (validation.ok !== true) {
    return { record, blockers, warnings, missing: [`unusable security lane findings (${validation.offendingIds.join(', ') || 'unreadable'})`] };
  }

  for (const recorded of findings) {
    const { entry, rejectedBecause } = applyProvenance(recorded, headSha, true, policy);
    const id = String(entry.id);
    if (entry.cleared === true && !isActionable(entry)) {
      record.cleared.push(id);
      continue;
    }
    const reason = resolutionReason(entry);
    if (reason !== null && !isActionable(entry)) {
      record.resolved.push({ id, reason });
      continue;
    }
    record.open.push(id);
    blockers.push(
      blocker(
        BLOCKER_CODES.SECURITY_FINDING_OPEN,
        rejectedBecause === null
          ? `the security review found ${nameOf(entry)} and it is still open`
          : `the security review found ${nameOf(entry)} and it is still open: its recorded resolution does not count (${rejectedBecause})`,
        rejectedBecause === null
          ? 'fix it, or have the operator record the decision on the current head with their login, a timestamp, a reason and a decision, accept or follow-on (ledger resolve)'
          : 'fix it, or have the operator record the decision again on the current head with their login, a timestamp, a reason and a decision, accept or follow-on (ledger resolve)',
        {
          findingId: id,
          locationOrLink: entry.locationOrLink || null,
          ...(rejectedBecause === null ? {} : { resolutionRejected: rejectedBecause }),
        }
      )
    );
  }

  return { record, blockers, warnings, missing: [] };
}

/**
 * The blocker of one open coverage gap (kata k48x): what was not read, why, and the two things that end it. The gap's own
 * sentence is the message (it names the slice and the paths); every path is in `paths`.
 */
function coverageBlocker({ gap, rejectedBecause }) {
  return blocker(
    BLOCKER_CODES.COVERAGE_INCOMPLETE,
    rejectedBecause === null ? String(gap.failureMode) : `${String(gap.failureMode)}: its recorded decision does not count (${rejectedBecause})`,
    'run the review again on this head so these paths are read, or have the operator accept the gap on the current head with their login, a timestamp, a reason and a decision, accept or follow-on (ledger resolve)',
    {
      gapId: String(gap.id),
      gapType: isText(gap.gapType) ? gap.gapType : null,
      sliceId: isText(gap.sliceId) ? gap.sliceId : null,
      paths: gap.paths.slice(),
      ...(Array.isArray(gap.reasons) && gap.reasons.length > 0 ? { reasons: gap.reasons } : {}),
      ...(rejectedBecause === null ? {} : { resolutionRejected: rejectedBecause }),
    }
  );
}

/**
 * Decide whether a PR may merge.
 *
 * @param {Object} input
 * @param {Object[]} input.ledger        The finding ledger for the current head.
 * @param {Object}   input.approvals     The `evaluateApprovals` result.
 * @param {Object}   [input.tier]        The `effectiveTier` result; falls back to `approvals.tier`.
 * @param {Object}   input.description   The `checkDescription` result.
 * @param {Object}   input.security      `{ status: 'clean'|'findings'|'not-run'|'unavailable', findings?, reason? }`.
 * @param {Object}   input.coverage      `{ status: 'complete'|'incomplete'|'unavailable', gaps?, reason? }` (pr-review-coverage.js). REQUIRED: absent is `review-data-unavailable`.
 * @param {string}   [input.headSha]     The commit the gate was asked about; echoed back. A resolution counts only when it was decided against this commit.
 * @param {Object}   [input.policy]      The policy block (`botLogins`, `maintainerLogins`): a resolution counts only from a login it lets decide. Without one the login is checked for shape alone.
 * @param {string[]} [input.unavailable] Data the caller could not collect (for example `gh-unreachable`).
 * @returns {{ok:boolean, mergeable:boolean, blockers:Object[], warnings:string[],
 *   findings:{important:number, nits:number, preExisting:number, unrecognised:number, open:string[]},
 *   securityLane:Object, coverage:{status:string, open:string[], decided:Object[], unreadable:string[]},
 *   approvals:Object|null, tier:string|null, reasons:string[]}}
 */
function evaluateGate(input) {
  if (!isObject(input)) return unreadable(['the gate payload is not an object']);

  const missing = [];
  const blockers = [];
  const warnings = [];

  // The gate answers "may THIS commit merge?": without a head it has no commit to
  // bind approvals or the ledger to, so a pass could not be tied to anything.
  if (!isText(input.headSha)) missing.push('headSha');

  // --- Caller-reported outages ------------------------------------------
  if (input.unavailable !== undefined && input.unavailable !== null) {
    if (!Array.isArray(input.unavailable)) missing.push('unreadable unavailable[] list');
    else for (const entry of input.unavailable) missing.push(isText(entry) ? entry.trim() : 'an unnamed unavailable input');
  }

  // --- Ledger -------------------------------------------------------------
  let findingsRecord = { important: 0, nits: 0, preExisting: 0, unrecognised: 0, open: [] };
  if (!Array.isArray(input.ledger)) {
    missing.push('ledger');
  } else {
    const validation = validateLedger(input.ledger);
    if (validation.ok !== true) {
      missing.push(`unusable ledger findings (${validation.offendingIds.join(', ') || 'unreadable'})`);
    } else {
      const parts = partitionFindings(input.ledger);
      if (parts.ok !== true) {
        missing.push(`unreadable ledger (${parts.reason})`);
      } else {
        const open = [];
        for (const recorded of parts.findings) {
          const { entry, rejectedBecause, deferralRejected } = applyProvenance(recorded, input.headSha, false, input.policy);
          if (!isActionable(entry)) continue;
          const severity = normalizeSeverity(entry.severity);
          if (severity === 'nit') continue; // AC-008-4: a Nit never blocks the merge.
          const id = String(entry.id);
          open.push(id);
          const unrecognised = severity === null;
          // A Critical reads as Important once a ledger has been read (`normalizeFinding`), so `entry.severity` cannot name it:
          // the blocker asks `isCritical`, the one reading, and says what the finding is. The verdict is the same either way.
          const critical = !unrecognised && isCritical(entry);
          blockers.push(
            blocker(
              unrecognised ? BLOCKER_CODES.OPEN_UNRECOGNISED_FINDING : BLOCKER_CODES.OPEN_IMPORTANT_FINDING,
              (unrecognised
                ? `finding ${nameOf(entry)} carries a severity this gate cannot read ('${String(entry.severity)}'), so it is treated as Important and is still open`
                : `${critical ? 'Critical' : 'Important'} finding ${nameOf(entry)} is still open`) + refusalNote(rejectedBecause, deferralRejected),
              rejectedBecause !== null
                ? 'fix it, or have the operator record the decision again on the current head with their login, a timestamp, a reason and a decision, accept or follow-on (ledger resolve)'
                : unrecognised
                  ? 'retag it with Important, Nit or Pre-existing, then fix it or have the operator record the decision (ledger resolve)'
                  : 'fix it, or have the operator record the decision on the current head with their login, a timestamp, a reason and a decision, accept or follow-on (ledger resolve)',
              {
                findingId: id,
                locationOrLink: entry.locationOrLink || null,
                severity: critical ? 'critical' : entry.severity,
                ...(rejectedBecause === null ? {} : { resolutionRejected: rejectedBecause }),
                ...(deferralRejected === null ? {} : { deferralRejected }),
              }
            )
          );
        }
        if (parts.nits.some((entry) => isActionable(entry))) warnings.push('open-nits-not-blocking');
        findingsRecord = {
          important: parts.important.length,
          nits: parts.nits.length,
          preExisting: parts.preExisting.length,
          unrecognised: parts.unrecognised.length,
          open,
        };
      }
    }
  }

  // --- Approvals ----------------------------------------------------------
  const approvalsResult = isObject(input.approvals) && input.approvals.ok === true ? input.approvals : null;
  if (approvalsResult === null) {
    missing.push(
      isObject(input.approvals) ? `approvals (the evaluator refused its input: ${input.approvals.reason || 'no reason given'})` : 'approvals'
    );
  } else if (approvalsResult.satisfied !== true) {
    const required = Number.isInteger(approvalsResult.humansRequired) ? approvalsResult.humansRequired : null;
    const counted = Number.isInteger(approvalsResult.humansCounted) ? approvalsResult.humansCounted : 0;
    blockers.push(
      blocker(
        BLOCKER_CODES.APPROVALS_UNSATISFIED,
        required === null
          ? 'the required human approvals are not satisfied'
          : `${counted} of ${required} required human approval(s) are bound to the current commit`,
        'request review from a person who has not approved this head, then re-run the gate once they approve',
        { reason: approvalsResult.reason || 'insufficient-human-approvals', humansRequired: required, humansCounted: counted }
      )
    );
  }

  const tier = readTier(input.tier, approvalsResult);
  if (tier === null) missing.push('tier');

  // The approvals result must have been computed against the tier floor and
  // the commit the gate is asked about (fail closed on either mismatch).
  if (approvalsResult !== null) {
    const problems = [];
    const tierResult = isObject(input.tier) && input.tier.ok !== false ? input.tier : null;
    if (tierResult !== null && tier !== null) {
      let floor = Math.max(
        HUMANS_REQUIRED[tier],
        Number.isInteger(tierResult.humansRequired) && tierResult.humansRequired >= 0 ? tierResult.humansRequired : 0
      );
      // Solo maintainer: the tier record says the PR is eligible and the
      // approvals result says the eligible maintainer directed it. Both must
      // name the same person, else the two-human floor stands. The evaluator
      // reports `soloMaintainer: true` only for a sole-maintainer director with
      // a known PR author: one who is not the author has an APPROVED review
      // bound to the head, one who is the author stands on their own credit
      // (`solo-maintainer-self-credit`). The gate has no reviews to re-check
      // that against, so it holds the claim to the same person, the same tier
      // and the one-human floor, never lower.
      const solo = isObject(tierResult.soloMaintainer) ? tierResult.soloMaintainer : null;
      const soloLogin = solo !== null && solo.eligible === true && isText(solo.login) ? solo.login.trim().replace(/^@/, '').toLowerCase() : null;
      const directed = isText(approvalsResult.directedBy) ? approvalsResult.directedBy.trim().replace(/^@/, '').toLowerCase() : null;
      if (tier === 'high' && floor === HUMANS_REQUIRED.high && soloLogin !== null && approvalsResult.soloMaintainer === true && directed === soloLogin) {
        floor = 1;
      }
      const approvalsTier = isText(approvalsResult.tier) ? approvalsResult.tier.trim().toLowerCase() : null;
      const approvalsRank = approvalsTier === null ? -1 : TIERS.indexOf(approvalsTier);
      if (approvalsRank < TIERS.indexOf(tier)) {
        problems.push(`approvals were evaluated at tier '${approvalsTier}' but the effective tier is '${tier}'`);
      }
      if (!Number.isInteger(approvalsResult.humansRequired) || approvalsResult.humansRequired < floor) {
        problems.push(`approvals required ${String(approvalsResult.humansRequired)} human(s) but the tier requires ${floor}`);
      }
    }
    // An approvals result that names no commit is bound to nothing: it is as
    // unusable as one bound to another commit.
    const carried = isText(approvalsResult.headSha) ? approvalsResult.headSha.trim().toLowerCase() : null;
    const gateSha = isText(input.headSha) ? input.headSha.trim().toLowerCase() : null;
    if (carried === null || gateSha === null || carried !== gateSha) {
      problems.push(
        `approvals were evaluated for commit ${carried === null ? '(none named)' : carried}, not ${gateSha === null ? '(no head given to the gate)' : gateSha}`
      );
    }
    if (problems.length > 0) {
      blockers.push(
        blocker(
          BLOCKER_CODES.APPROVALS_TIER_MISMATCH,
          `the approvals result does not match the gate's tier or commit: ${problems.join('; ')}`,
          're-run the approvals evaluation against the current head and the current effective tier, then re-run the gate',
          { problems }
        )
      );
    }
  }

  // --- Description (AC-002-3) --------------------------------------------
  if (!isObject(input.description) || input.description.ok !== true || !Array.isArray(input.description.missing)) {
    missing.push('description');
  } else {
    for (const section of input.description.missing) {
      const named = isText(section) ? section.trim() : 'an unnamed section';
      blockers.push(
        blocker(
          BLOCKER_CODES.DESCRIPTION_SECTION_MISSING,
          `the PR description is missing its ${named} section, so this PR is not ready for approval`,
          `add a ${named} section to the PR description, then re-run the gate`,
          { section: named }
        )
      );
    }
  }

  // --- Security lane (AC-017-1..3) ---------------------------------------
  let securityLane = { status: 'unavailable', open: [], cleared: [], resolved: [] };
  if (!isObject(input.security)) {
    missing.push('security');
  } else {
    const graded = gradeSecurityLane(input.security, tier, isText(input.headSha) ? input.headSha : null, input.policy);
    securityLane = graded.record;
    blockers.push(...graded.blockers);
    warnings.push(...graded.warnings);
    for (const entry of graded.missing) missing.push(`security: ${entry}`);
  }

  // --- Review coverage (kata k48x) ---------------------------------------
  // A path nobody read is never read as reviewed. An open gap blocks until the review is run again or the operator's decision
  // on it (a resolution with provenance, bound to this head) is recorded; coverage that cannot be read is unavailable data.
  let coverageRecord = { status: 'unavailable', open: [], decided: [], unreadable: [] };
  if (!isObject(input.coverage)) {
    missing.push('coverage');
  } else {
    const graded = gradeCoverage(input.coverage, { headSha: isText(input.headSha) ? input.headSha : null, policy: input.policy });
    coverageRecord = {
      status: graded.status === null ? 'unavailable' : graded.status,
      open: graded.open.map(({ gap }) => String(gap.id)),
      decided: graded.decided.map(({ gap, reason, by, at }) => ({ id: String(gap.id), reason, by, at })),
      unreadable: graded.missing.slice(),
    };
    for (const entry of graded.open) blockers.push(coverageBlocker(entry));
    if (graded.decided.length > 0) warnings.push('coverage-gap-accepted');
    for (const entry of graded.missing) missing.push(`coverage: ${entry}`);
  }

  // --- Unavailable data outranks everything -------------------------------
  if (missing.length > 0) {
    blockers.unshift(
      blocker(
        BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE,
        `the merge gate could not read required review data: ${missing.join(', ')}`,
        NEXT_ACTION_DATA,
        { missing: missing.slice() }
      )
    );
  }

  const mergeable = blockers.length === 0;
  const reasons = mergeable ? ['mergeable'] : Array.from(new Set(blockers.map((entry) => entry.code)));

  return {
    ok: true,
    mergeable,
    blockers,
    warnings,
    findings: findingsRecord,
    securityLane,
    coverage: coverageRecord,
    approvals: approvalsResult,
    tier,
    headSha: isText(input.headSha) ? input.headSha.trim() : null,
    reasons,
  };
}

/**
 * Which recorded findings this gate holds open, asked of the gate itself.
 *
 * The operator's decision list (`pr-review-disposition.js`) must say what the
 * verdict says about what blocks, and a second copy of that rule would drift
 * from it. So the list keeps none: it asks here, and this runs `evaluateGate`
 * on the findings alone. Approvals, tier and description cannot change which
 * findings are open, so they are left out and the verdict's other blockers are
 * never read.
 *
 * Fail closed on what the gate cannot read: findings that fail `validateLedger`
 * answer `ok: false`, never an empty set.
 *
 * @param {{ledger:Object[], laneFindings?:Object[], headSha:string, policy?:Object}} input
 *   `laneFindings` are the entries of the security lane, graded as a lane that
 *   ran.
 * @returns {{ok:true, ledgerOpen:Set<string>, laneOpen:Set<string>}|{ok:false, reason:string}}
 *   The ids (as `String(id)`) of the ledger findings and of the lane findings
 *   the gate holds open.
 */
function findingsHeldOpen({ ledger, laneFindings = [], headSha, policy }) {
  for (const [what, list] of [['ledger findings', ledger], ['security lane findings', laneFindings]]) {
    const validation = validateLedger(list);
    if (validation.ok !== true) return { ok: false, reason: `unusable ${what} (${validation.offendingIds.join(', ') || 'unreadable'})` };
  }
  const verdict = evaluateGate({
    headSha,
    policy,
    ledger,
    security: laneFindings.length === 0 ? { status: 'clean', findings: [] } : { status: 'findings', findings: laneFindings },
  });
  return { ok: true, ledgerOpen: new Set(verdict.findings.open), laneOpen: new Set(verdict.securityLane.open) };
}

/**
 * Which coverage gaps this gate holds open, asked of the gate itself (the same reason `findingsHeldOpen` exists): the
 * operator's decision list must say what the verdict says about what blocks, so it keeps no copy of the rule.
 *
 * @param {{coverage:Object, headSha:string, policy?:Object}} input
 * @returns {{ok:true, open:Set<string>, decided:Object[], unavailable:boolean}|{ok:false, reason:string}}
 *   `open` are the gap ids (as `String(id)`) the gate holds open; `decided` the `{ id, reason, by, at }` it takes as the
 *   operator's decision. A coverage the gate cannot read answers `ok: false`, never an empty set. A coverage that SAYS
 *   `unavailable` is readable (the gate reports it as missing data, `unavailable: true`) and has no gap to decide.
 */
function coverageHeldOpen({ coverage, headSha, policy }) {
  if (!isObject(coverage)) return { ok: false, reason: 'coverage must be an object' };
  const verdict = evaluateGate({ headSha, policy, coverage, ledger: [], security: { status: 'clean', findings: [] } });
  const declared = isText(coverage.status) ? coverage.status.trim().toLowerCase() : null;
  if (declared === 'unavailable') return { ok: true, open: new Set(), decided: [], unavailable: true };
  if (verdict.coverage.unreadable.length > 0) return { ok: false, reason: `unusable coverage (${verdict.coverage.unreadable.join('; ')})` };
  return { ok: true, open: new Set(verdict.coverage.open), decided: verdict.coverage.decided, unavailable: false };
}

module.exports = { evaluateGate, findingsHeldOpen, coverageHeldOpen, BLOCKER_CODES, SECURITY_STATUSES, SECURITY_REQUIRED_TIERS };
