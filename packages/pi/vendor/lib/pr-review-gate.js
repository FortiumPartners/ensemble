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
 *
 * It is mergeable ONLY when no Important finding is open (including every open
 * security-lane finding), approvals are satisfied, and no required description
 * section is missing (AC-008-1, AC-017-1, AC-002-3). Nit and Pre-existing
 * findings never block (AC-008-4).
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

const { validateLedger, partitionFindings, isActionable, normalizeSeverity } = require('./pr-review-ledger');
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
 * An open lane finding blocks; one closed with a stated reason is recorded and
 * stops blocking (AC-017-3); one a later head fixed clears on its own
 * (AC-017-2); a lane that never ran blocks Medium and High (AC-017-1).
 */
function gradeSecurityLane(lane, tier) {
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

  for (const entry of findings) {
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
        `the security review found ${nameOf(entry)} and it is still open`,
        'fix it, or close it with a stated reason recorded on the finding',
        { findingId: id, locationOrLink: entry.locationOrLink || null }
      )
    );
  }

  return { record, blockers, warnings, missing: [] };
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
 * @param {string}   [input.headSha]     The commit the gate was asked about; echoed back.
 * @param {string[]} [input.unavailable] Data the caller could not collect (for example `gh-unreachable`).
 * @returns {{ok:boolean, mergeable:boolean, blockers:Object[], warnings:string[],
 *   findings:{important:number, nits:number, preExisting:number, unrecognised:number, open:string[]},
 *   securityLane:Object, approvals:Object|null, tier:string|null, reasons:string[]}}
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
        for (const entry of parts.findings) {
          if (!isActionable(entry)) continue;
          const severity = normalizeSeverity(entry.severity);
          if (severity === 'nit') continue; // AC-008-4: a Nit never blocks the merge.
          const id = String(entry.id);
          open.push(id);
          const unrecognised = severity === null;
          blockers.push(
            blocker(
              unrecognised ? BLOCKER_CODES.OPEN_UNRECOGNISED_FINDING : BLOCKER_CODES.OPEN_IMPORTANT_FINDING,
              unrecognised
                ? `finding ${nameOf(entry)} carries a severity this gate cannot read ('${String(entry.severity)}'), so it is treated as Important and is still open`
                : `Important finding ${nameOf(entry)} is still open`,
              unrecognised
                ? 'retag it with Important, Nit or Pre-existing, then fix it or answer it with a recorded reason'
                : 'fix it, or answer it with a recorded reason on the finding',
              { findingId: id, locationOrLink: entry.locationOrLink || null, severity: entry.severity }
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
      // reports `soloMaintainer: true` only for a director it authenticated
      // (not the PR author, with an APPROVED review bound to the head); the
      // gate has no reviews to re-check that against, so it holds the claim to
      // the same person, the same tier and the one-human floor, never lower.
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
    const graded = gradeSecurityLane(input.security, tier);
    securityLane = graded.record;
    blockers.push(...graded.blockers);
    warnings.push(...graded.warnings);
    for (const entry of graded.missing) missing.push(`security: ${entry}`);
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
    approvals: approvalsResult,
    tier,
    headSha: isText(input.headSha) ? input.headSha.trim() : null,
    reasons,
  };
}

module.exports = { evaluateGate, BLOCKER_CODES, SECURITY_STATUSES, SECURITY_REQUIRED_TIERS };
