'use strict';

/**
 * Risk-tier assignment: change kinds, the sensitive floor and raise-only
 * proposals (TRD-023, REQ-012, REQ-013, REQ-015).
 *
 * NO side effects, NO shell, NO network, NO file reads. A pure function over
 * the classifier's output and the path classification from
 * `pr-review-paths.js`.
 *
 * The tier comes from the CHANGE, never from the author (AC-012-2): `author`
 * and `maintainers` may be passed for the record, and neither is read when the
 * tier is computed.
 *
 * FAIL CLOSED, which for a risk tier means MORE review, never less:
 *   - a request, or a path classification, this module cannot read is `high`
 *     with `ok:false`;
 *   - a missing, unknown or uncited kind is `other`, which is Medium: a
 *     classifier that says nothing cannot buy a cheaper review;
 *   - a second assessment that is not exactly `false` raises the tier; one
 *     nobody gave (omitted or null) cannot say "no" either, so it raises
 *     nothing but demands another person, which keeps the solo-maintainer
 *     discount off;
 *   - a proposal may raise a tier; lowering one needs a CODEOWNERS-checked
 *     owner decision, and nothing lowers it below the sensitive floor;
 *   - the solo-maintainer discount leans on a changed-path list it can trust:
 *     present, non-empty and made of verbatim names. A list that is missing,
 *     or holds a name git quoted, or one with a control character or a line or
 *     paragraph separator in it, cannot vouch that no sensitive path changed.
 *
 * The Low WAIVER and the effective tier it produces are TRD-041's: this
 * function answers the assigned tier and the facts behind it.
 */

/** The closed set of tiers, cheapest first. */
const TIERS = Object.freeze(['low', 'medium', 'high']);

/** The closed set of change kinds (data model: unknown or uncited = `other`). */
const KINDS = Object.freeze(['docs', 'copy', 'additive-behind-flag', 'product', 'other']);

/** The kinds that, on their own, make a PR Low risk (AC-012-1). */
const LOW_KINDS = Object.freeze(['docs', 'copy', 'additive-behind-flag']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isPathList = (value) => Array.isArray(value) && value.every((entry) => isText(entry));

/**
 * The characters no verbatim name holds: the control characters (C0, DEL and
 * C1, which has NEL, U+0085) and the Unicode line and paragraph separators
 * (U+2028, U+2029).
 */
const NOT_VERBATIM = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/**
 * Whether `name` is a verbatim path. Git prints a name in double quotes, with
 * C escapes (`".github/workflows/\303\251.yml"`), when it holds a non-ASCII
 * byte, a control character, `"` or `\` -- unless the listing is
 * NUL-delimited (`-z`), when it prints every name as it is. A quoted name
 * matches no sensitive pattern, and neither does one with a tab or newline
 * left in it by a `--name-status` or newline-split listing, so an entry like
 * either means the list was not produced the documented way. Even `-z` leaves
 * a name holding a control character or a line or paragraph separator (git
 * prints U+2028 and U+2029 raw) as a name no pattern can be trusted to read, so
 * such a name fails closed too: it is no evidence that nothing sensitive changed.
 */
function isVerbatimName(name) {
  return !name.startsWith('"') && !NOT_VERBATIM.test(name);
}

/** A word from a closed set, compared on letter case only -- a padded word is not the word. */
function fromSet(value, set) {
  if (typeof value !== 'string') return null;
  const key = value.toLowerCase();
  return set.includes(key) ? key : null;
}

const rank = (tier) => TIERS.indexOf(tier);
const higher = (left, right) => (rank(left) >= rank(right) ? left : right);
const raiseOne = (tier) => TIERS[Math.min(rank(tier) + 1, TIERS.length - 1)];

/** The fail-closed answer: the deepest tier, the reason named, nothing granted. */
function blocked(reason) {
  return {
    ok: false,
    tier: 'high',
    baseTier: 'high',
    floor: 'high',
    kinds: [],
    uncitedPaths: [],
    reasons: [reason],
    raised: [],
    lowered: [],
    ignored: [],
    warnings: [reason],
  };
}

/**
 * Reads the path classification: either a `classifyPaths` result or a plain
 * `{ sensitive, high }`. Returns null when it cannot be read, and `blocked`
 * when `classifyPaths` itself refused the request.
 */
function readPaths(value, warnings) {
  if (!isObject(value)) return null;
  if (value.ok === false) return { blocked: true };
  if (!isPathList(value.sensitive === undefined ? [] : value.sensitive)) return null;
  if (!isPathList(value.high === undefined ? [] : value.high)) return null;

  let changedPaths = null;
  if (Array.isArray(value.paths)) {
    const entries = Array.from(value.paths);
    if (entries.every((entry) => isObject(entry) && isText(entry.path))) {
      changedPaths = entries.map((entry) => entry.path);
    } else if (entries.every((entry) => isText(entry))) {
      changedPaths = entries.slice();
    } else {
      warnings.push('invalid-changed-paths');
    }
  }

  // The list can vouch for what the classification says about it only when it
  // is there, names something, and names it verbatim.
  let changedPathsReadable = false;
  if (changedPaths !== null) {
    const verbatim = changedPaths.every(isVerbatimName);
    if (!verbatim) warnings.push('non-verbatim-changed-path');
    changedPathsReadable = verbatim && changedPaths.length > 0;
  }

  return {
    blocked: false,
    sensitive: value.sensitive === undefined ? [] : value.sensitive.slice(),
    high: value.high === undefined ? [] : value.high.slice(),
    declarationChanged: typeof value.declarationChanged === 'boolean' ? value.declarationChanged : null,
    changedPaths,
    changedPathsReadable,
  };
}

/**
 * Reads the classifier's `kinds`, normalizing each record to a known kind.
 * A record that is not an object, carries no kind, carries a word outside the
 * closed set, or cites no readable path list, becomes `other` -- and `other`
 * is Medium. A "docs" claim that cites nothing checkable is exactly the claim
 * that must not buy a cheaper review.
 */
function readKinds(value, reasons, warnings) {
  if (!Array.isArray(value) || value.length === 0) {
    reasons.push('no-kinds-cited');
    return [];
  }

  return Array.from(value).map((record) => {
    if (!isObject(record)) {
      warnings.push('invalid-kind-record');
      return { kind: 'other', declared: record === undefined ? null : record, paths: [] };
    }

    const declaredKind = fromSet(record.kind, KINDS);
    if (declaredKind === null && !reasons.includes('unknown-kind')) reasons.push('unknown-kind');

    const pathsReadable = isPathList(record.paths);
    if (!pathsReadable) warnings.push('invalid-kind-paths');

    const kind = declaredKind === null || !pathsReadable ? 'other' : declaredKind;
    const entry = { kind, paths: pathsReadable ? record.paths.slice() : [] };
    if (kind !== declaredKind) entry.declared = record.kind === undefined ? null : record.kind;
    return entry;
  });
}

/**
 * Assigns the risk tier for a PR.
 *
 * @param {Object} input
 * @param {Array<{kind:string, paths:string[]}>} input.kinds  The classifier's output.
 * @param {Object} input.paths          A `classifyPaths` result, or `{ sensitive[], high[], paths? }`.
 * @param {Object} [input.secondAssessment]  `{ needsAnotherPerson, reason, evidencePaths[] }`.
 * @param {string} [input.proposedTier]      A tier proposed by an agent or the author.
 * @param {{login:string, isCodeOwner:boolean}} [input.proposedBy]  Who proposed it; only an
 *   explicitly CODEOWNERS-checked owner may lower a tier.
 * @param {string} [input.author]       Recorded, never read: the tier comes from the change.
 * @returns {{ok:boolean, tier:string, baseTier:string, floor:string|null, kinds:Object[],
 *   uncitedPaths:string[], reasons:string[], raised:Array, lowered:Array, ignored:Array, warnings:string[]}}
 */
function assignTier(input) {
  if (!isObject(input)) return blocked('invalid-input');

  const reasons = [];
  const warnings = [];
  const raised = [];
  const lowered = [];
  const ignored = [];

  const classification = readPaths(input.paths, warnings);
  if (classification === null) return blocked('invalid-path-classification');
  if (classification.blocked) return blocked('path-classification-blocked');

  // --- The kind of change (AC-012-1) --------------------------------------
  const kinds = readKinds(input.kinds, reasons, warnings);
  const citedPaths = new Set(kinds.flatMap((entry) => entry.paths));
  const uncitedPaths = classification.changedPaths === null
    ? []
    : classification.changedPaths.filter((path) => !citedPaths.has(path));
  if (uncitedPaths.length > 0) reasons.push('uncited-path');

  const everyKindLow = kinds.length > 0 && kinds.every((entry) => LOW_KINDS.includes(entry.kind));
  let baseTier;
  if (everyKindLow && uncitedPaths.length === 0) {
    baseTier = 'low';
    reasons.push('all-kinds-low-risk');
  } else {
    baseTier = 'medium';
    if (kinds.some((entry) => entry.kind === 'product')) reasons.push('product-change');
  }

  // --- The sensitive floor (AC-013-3) -------------------------------------
  let floor = null;
  if (classification.sensitive.length > 0) {
    floor = 'high';
    reasons.push('sensitive-path');
  }
  if (classification.high.length > 0) {
    floor = 'high';
    reasons.push('owner-high-path');
  }

  let tier = floor === null ? baseTier : higher(baseTier, floor);

  // --- The second assessment (AC-012-3) -----------------------------------
  // An assessment that did not say "no" demands another person. So does one
  // nobody gave: a subagent that failed, timed out or was skipped leaves the
  // key out, and an absence cannot be read as "no". Nothing is raised for it
  // (a PR no one assessed keeps the tier its change earns); `peerDemanded`
  // keeps the solo-maintainer discount off.
  let peerDemanded = false;
  const assessment = input.secondAssessment;
  if (assessment !== undefined && assessment !== null) {
    let needsAnotherPerson;
    let reason;
    if (isObject(assessment)) {
      needsAnotherPerson = assessment.needsAnotherPerson;
      reason = isText(assessment.reason) ? assessment.reason : 'second-assessment-unreadable';
    } else {
      // Not a record at all: it cannot say "no", so it is read as "yes".
      warnings.push('invalid-second-assessment');
      needsAnotherPerson = true;
      reason = 'second-assessment-unreadable';
    }

    if (needsAnotherPerson !== false) {
      peerDemanded = true;
      if (needsAnotherPerson !== true) reason = 'second-assessment-unreadable';
      const next = raiseOne(tier);
      if (next !== tier) raised.push({ from: tier, to: next, reason });
      tier = next;
    }
  } else {
    peerDemanded = true;
    reasons.push('second-assessment-missing');
  }

  // --- The proposal: raise-only (AC-013-2) --------------------------------
  if (input.proposedTier !== undefined && input.proposedTier !== null && input.proposedTier !== '') {
    const proposed = fromSet(input.proposedTier, TIERS);
    const by = isObject(input.proposedBy) && isText(input.proposedBy.login) ? input.proposedBy.login : null;
    const isCodeOwner = isObject(input.proposedBy) && input.proposedBy.isCodeOwner === true;

    if (proposed === 'high') peerDemanded = true;

    if (proposed === null) {
      warnings.push('unknown-proposed-tier');
    } else if (rank(proposed) > rank(tier)) {
      raised.push({ from: tier, to: proposed, reason: 'proposed-tier' });
      tier = proposed;
    } else if (rank(proposed) < rank(tier)) {
      if (!isCodeOwner) {
        ignored.push({ proposedTier: proposed, by, reason: 'lowering-needs-code-owner' });
      } else if (floor !== null && rank(proposed) < rank(floor)) {
        // The sensitive floor holds against everyone: to lower it, change the
        // declaration on the target branch, not the tier on this PR.
        ignored.push({ proposedTier: proposed, by, reason: 'sensitive-floor-holds' });
      } else {
        lowered.push({ from: tier, to: proposed, by });
        tier = proposed;
      }
    }
  }

  return {
    ok: true,
    tier,
    baseTier,
    floor,
    kinds,
    // The paths that drove the floor, kept so the recorded decision can name
    // them (TRD-041, AC-015-1) rather than make the reader re-derive them.
    sensitivePaths: classification.sensitive.slice(),
    // Whether the PR edits the review declaration itself (a policy change
    // with no listed sensitive path still counts). `null` = not stated.
    declarationChanged: classification.declarationChanged,
    highPaths: classification.high.slice(),
    // Whether the changed-path list those facts were computed from can be
    // trusted: present, non-empty and made of verbatim names. The solo-
    // maintainer discount leans on `sensitivePaths` and `declarationChanged`,
    // which say nothing about a path the list does not name as it is.
    changedPathsReadable: classification.changedPathsReadable,
    // An "another person must look at this" signal: a second assessment that
    // did not say no (one nobody gave included) or a proposal of High, kept
    // even when the tier was already High and nothing rose.
    peerDemanded,
    uncitedPaths,
    reasons,
    raised,
    lowered,
    ignored,
    warnings,
  };
}

/**
 * The evidence a repository must have RECORDED before a Low PR may skip human
 * approval (AC-013-1). These are the PRD's numbers, kept here as one named
 * constant so a reader can check them against the requirement.
 */
const WAIVER_EVIDENCE_MINIMUMS = Object.freeze({ lowPrs: 20, days: 30, maxReverts: 0, maxIncidents: 0 });

/** Humans required by effective tier: an effective-Low PR needs none, Medium one, High two. */
const HUMANS_REQUIRED = Object.freeze({ low: 0, medium: 1, high: 2 });

const SOLO_NOT_ELIGIBLE = Object.freeze({ eligible: false, login: null });

/**
 * Whether the solo-maintainer rule MAY relax a High PR from two humans to one
 * (policy `soloMaintainer: true`). Eligible only when every fact is readable
 * and holds: the policy names exactly one maintainer, the tier is High, the
 * changed-path list can be trusted, and the PR touches no sensitive path (the
 * guards guard themselves: CI, release gates, the review policy and review
 * code always keep two humans). Whether the sole maintainer actually directed
 * the PR, did not write it and approved its head is checked by the approvals
 * evaluator, which sees the reviews; the gate checks both agree.
 *
 * @returns {{eligible:boolean, login:string|null}}
 */
function soloEligibility(tier, policy, assignment) {
  if (tier !== 'high' || policy === null || policy.soloMaintainer !== true) return SOLO_NOT_ELIGIBLE;
  if (!Array.isArray(policy.maintainerLogins)) return SOLO_NOT_ELIGIBLE;
  const logins = new Set(
    policy.maintainerLogins.filter(isText).map((login) => login.trim().replace(/^@/, '').toLowerCase())
  );
  if (logins.size !== 1) return SOLO_NOT_ELIGIBLE;
  // `declarationChanged` and `sensitivePaths` are only as good as the list they
  // came from: one that is missing, empty or holds a name that is not verbatim
  // (quoted by git, or holding a control character or a line or paragraph
  // separator) cannot vouch that no sensitive path changed.
  if (assignment.changedPathsReadable !== true) return SOLO_NOT_ELIGIBLE;
  if (assignment.declarationChanged !== false) return SOLO_NOT_ELIGIBLE;
  if (!Array.isArray(assignment.sensitivePaths) || assignment.sensitivePaths.length !== 0) return SOLO_NOT_ELIGIBLE;
  // A tier that was RAISED (a second assessment or a proposal) reached High
  // precisely to demand another person; the solo rule must not cancel that.
  if (!Array.isArray(assignment.raised) || assignment.raised.length !== 0) return SOLO_NOT_ELIGIBLE;
  // The same demand when the tier was ALREADY High and so nothing rose: a
  // second assessment that did not say no (one nobody gave included), or a
  // proposal of High.
  if (assignment.peerDemanded !== false) return SOLO_NOT_ELIGIBLE;
  return { eligible: true, login: [...logins][0] };
}

/** The fail-closed effective tier: High, two humans, no waiver, the reason named. */
function blockedEffective(reason) {
  return {
    ok: false,
    tier: 'high',
    effectiveTier: 'high',
    humansRequired: HUMANS_REQUIRED.high,
    soloMaintainer: SOLO_NOT_ELIGIBLE,
    waiver: { applies: false, reason, evidence: null, enabledBy: null },
    refusals: [],
    reasons: [reason],
    warnings: [reason],
  };
}

/** A count that is really a count: an integer at or above zero. A numeric STRING is not a count. */
const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * The recorded Low-waiver evidence, or a named reason it cannot be used.
 * Every field must be present and readable: evidence that is partly missing
 * is not evidence, and "no reverts recorded" is not the same as "zero
 * reverts".
 */
function readEvidence(value) {
  if (value === undefined || value === null) return { ok: false, reason: 'no-evidence' };
  if (!isObject(value)) return { ok: false, reason: 'unreadable-evidence' };
  const { lowPrs, days, reverts, incidents } = value;
  if (![lowPrs, days, reverts, incidents].every(isCount)) return { ok: false, reason: 'unreadable-evidence' };
  return { ok: true, evidence: { lowPrs, days, reverts, incidents } };
}

/**
 * The effective tier: the tier a PR is actually reviewed and approved at
 * (AC-013-1, AC-013-4).
 *
 * A Low assignment is effectively MEDIUM -- one human approval -- unless all
 * four of these hold:
 *
 *   1. the policy has the Low waiver enabled (exactly `true`);
 *   2. a CODEOWNERS-checked code owner enabled it;
 *   3. the recorded evidence meets `WAIVER_EVIDENCE_MINIMUMS`: at least 20
 *      Low PRs over at least 30 days with zero reverts and zero incidents;
 *   4. the author is a repository maintainer -- every other author's Low PR
 *      still needs one human (AC-014-5).
 *
 * When the waiver is enabled but the evidence is missing or unreadable, the
 * attempt is REFUSED and named in `refusals` so the approval evaluator can
 * report why approval is still required (AC-013-4).
 *
 * Medium and High are untouched: no waiver lowers them.
 *
 * @param {{assignment:Object, policy?:Object, evidence?:Object,
 *   enabledBy?:{login:string, isCodeOwner:boolean}, author?:string}} input
 * @returns {{ok:boolean, tier:string, effectiveTier:string, humansRequired:number,
 *   waiver:{applies:boolean, reason:string, evidence:Object|null, enabledBy:string|null},
 *   refusals:Array<{code:string, detail:string, nextAction:string}>, reasons:string[], warnings:string[]}}
 */
function effectiveTier(input) {
  if (!isObject(input)) return blockedEffective('invalid-input');

  const assignment = input.assignment;
  if (!isObject(assignment)) return blockedEffective('invalid-assignment');
  if (assignment.ok === false) return blockedEffective('assignment-blocked');

  const tier = fromSet(assignment.tier, TIERS);
  if (tier === null) return blockedEffective('unknown-tier');

  const reasons = [];
  const warnings = [];
  const refusals = [];

  const policy = isObject(input.policy) ? input.policy : null;
  if (input.policy !== undefined && input.policy !== null && policy === null) warnings.push('unreadable-policy');

  const waiverEnabled = policy !== null && policy.lowWaiverEnabled === true;
  if (policy !== null && policy.lowWaiverEnabled !== undefined && typeof policy.lowWaiverEnabled !== 'boolean') {
    warnings.push('unreadable-low-waiver-flag');
  }

  const enabledByOwner = isObject(input.enabledBy) && input.enabledBy.isCodeOwner === true;
  const enabledByLogin = isObject(input.enabledBy) && isText(input.enabledBy.login) ? input.enabledBy.login : null;
  const maintainers = policy !== null && Array.isArray(policy.maintainerLogins)
    ? policy.maintainerLogins.filter(isText).map((login) => login.trim().replace(/^@/, '').toLowerCase())
    : [];
  const author = isText(input.author) ? input.author.trim().replace(/^@/, '').toLowerCase() : null;

  const deny = (reason) => {
    reasons.push(reason);
    return {
      ok: true,
      tier,
      effectiveTier: tier === 'low' ? 'medium' : tier,
      humansRequired: HUMANS_REQUIRED[tier === 'low' ? 'medium' : tier],
      soloMaintainer: soloEligibility(tier, policy, assignment),
      waiver: { applies: false, reason, evidence: null, enabledBy: enabledByLogin },
      refusals,
      reasons,
      warnings,
    };
  };

  if (tier !== 'low') return deny('not-low-tier');
  if (!waiverEnabled) return deny('waiver-not-enabled');
  if (!enabledByOwner) return deny('waiver-not-enabled-by-code-owner');

  const evidence = readEvidence(input.evidence);
  if (!evidence.ok) {
    refusals.push({
      code: 'low-waiver-unsupported',
      detail: evidence.reason,
      nextAction: 'record the Low-waiver evidence (20+ Low PRs over 30+ days, zero reverts, zero incidents) or request one human approval',
    });
    return deny(evidence.reason);
  }

  const { lowPrs, days, reverts, incidents } = evidence.evidence;
  if (lowPrs < WAIVER_EVIDENCE_MINIMUMS.lowPrs) return deny('insufficient-low-pr-count');
  if (days < WAIVER_EVIDENCE_MINIMUMS.days) return deny('insufficient-window');
  if (reverts > WAIVER_EVIDENCE_MINIMUMS.maxReverts) return deny('reverts-recorded');
  if (incidents > WAIVER_EVIDENCE_MINIMUMS.maxIncidents) return deny('incidents-recorded');
  if (author === null || !maintainers.includes(author)) return deny('author-not-maintainer');

  reasons.push('low-waiver-applied');
  return {
    ok: true,
    tier,
    effectiveTier: 'low',
    humansRequired: HUMANS_REQUIRED.low,
    soloMaintainer: SOLO_NOT_ELIGIBLE,
    waiver: { applies: true, reason: 'low-waiver-applied', evidence: evidence.evidence, enabledBy: enabledByLogin },
    refusals,
    reasons,
    warnings,
  };
}

/** The fail-closed tier record: High, two humans, the reason named, nothing granted. */
function blockedRecord(reason) {
  return {
    ok: false,
    tier: 'high',
    effectiveTier: 'high',
    humansRequired: HUMANS_REQUIRED.high,
    originalTier: 'high',
    finalTier: 'high',
    characteristics: [],
    paths: { sensitive: [], high: [], uncited: [] },
    reasons: [reason],
    raised: [],
    lowered: [],
    ignored: [],
    waiver: { applies: false, reason, evidence: null, enabledBy: null },
    soloMaintainer: { ...SOLO_NOT_ELIGIBLE },
    refusals: [],
    assignedBy: null,
    warnings: [reason],
  };
}

/**
 * The tier decision as it is written into the review-state report (AC-015-1,
 * AC-015-2): the tier and the effective tier, the humans they require, the
 * characteristics (change kinds) and paths that drove the decision, who or
 * what assigned it, every raise with its original tier, final tier and
 * reason, and the Low-waiver outcome with any refusal.
 *
 * Fail closed: a record that cannot be built is High with two humans. An
 * unrecorded tier is never an absent requirement.
 *
 * @param {{assignment:Object, effective:Object, assignedBy?:string, at?:string}} input
 * @returns {Object}
 */
function tierRecord(input) {
  if (!isObject(input)) return blockedRecord('invalid-input');
  const { assignment, effective } = input;
  if (!isObject(assignment) || assignment.ok !== true) return blockedRecord('invalid-assignment');
  if (!isObject(effective) || !Number.isInteger(effective.humansRequired) || effective.humansRequired < 0) {
    return blockedRecord('invalid-effective-tier');
  }

  const tier = fromSet(effective.tier, TIERS);
  const effectiveWord = fromSet(effective.effectiveTier, TIERS);
  if (tier === null || effectiveWord === null) return blockedRecord('unknown-tier');
  // The record may raise the floor for its tier but never lower it.
  const humansRequired = Math.max(effective.humansRequired, HUMANS_REQUIRED[effectiveWord]);

  const record = {
    ok: true,
    tier,
    effectiveTier: effectiveWord,
    humansRequired,
    originalTier: fromSet(assignment.baseTier, TIERS) === null ? tier : assignment.baseTier,
    finalTier: tier,
    characteristics: Array.isArray(assignment.kinds) ? assignment.kinds.map((entry) => ({ ...entry })) : [],
    paths: {
      sensitive: Array.isArray(assignment.sensitivePaths) ? assignment.sensitivePaths.slice() : [],
      high: Array.isArray(assignment.highPaths) ? assignment.highPaths.slice() : [],
      uncited: Array.isArray(assignment.uncitedPaths) ? assignment.uncitedPaths.slice() : [],
    },
    reasons: [...(Array.isArray(assignment.reasons) ? assignment.reasons : []), ...(Array.isArray(effective.reasons) ? effective.reasons : [])],
    raised: Array.isArray(assignment.raised) ? assignment.raised.map((entry) => ({ ...entry })) : [],
    lowered: Array.isArray(assignment.lowered) ? assignment.lowered.map((entry) => ({ ...entry })) : [],
    ignored: Array.isArray(assignment.ignored) ? assignment.ignored.map((entry) => ({ ...entry })) : [],
    waiver: isObject(effective.waiver) ? { ...effective.waiver } : { applies: false, reason: 'no-waiver-record', evidence: null, enabledBy: null },
    soloMaintainer: isObject(effective.soloMaintainer) && effective.soloMaintainer.eligible === true && isText(effective.soloMaintainer.login)
      ? { eligible: true, login: effective.soloMaintainer.login }
      : { ...SOLO_NOT_ELIGIBLE },
    refusals: Array.isArray(effective.refusals) ? effective.refusals.map((entry) => ({ ...entry })) : [],
    assignedBy: isText(input.assignedBy) ? input.assignedBy.trim() : null,
    warnings: [...(Array.isArray(assignment.warnings) ? assignment.warnings : []), ...(Array.isArray(effective.warnings) ? effective.warnings : [])],
  };
  if (isText(input.at)) record.at = input.at.trim();
  return record;
}

module.exports = {
  assignTier,
  effectiveTier,
  tierRecord,
  TIERS,
  KINDS,
  LOW_KINDS,
  WAIVER_EVIDENCE_MINIMUMS,
  HUMANS_REQUIRED,
};
