'use strict';

/**
 * Review-run mode: which of the two modes one PR review runs in.
 *
 * NO side effects, NO shell, NO network, NO file reads. Pure function over the
 * plain JSON the `tier` subcommand prints, the same contract as the rest of
 * the pr-review-* libraries.
 *
 * Two modes, one runner (docs/plans/pr-review-speedup-plan.md section 3G):
 *   - `light`  Low and Medium tier. The script alone runs the pipeline.
 *              The depth `depth` resolves for the effective tier: Standard (>= 2
 *              reviewers, 3 verifiers per finding) at Medium, Quick (1, 0) at an
 *              effective Low under the waiver. Plus the security lane wherever
 *              the gate requires it (Medium included).
 *   - `full`   High tier, a sensitive path, or anything ambiguous. Deep depth
 *              (>= 2 reviewers, 5 verifiers per finding) plus the security lane.
 *
 * The mode comes from the tier record the CLI computed. It is never read from
 * the size of the diff (#235 was 3 files and +33 lines but edited approval-gate
 * code and graded High) and never from an agent's judgement.
 *
 * FAIL CLOSED means FULL, here, never light: a record that is missing,
 * unreadable or only partly there, a tier or effective tier outside the closed
 * set, a tier word that contradicts the effective tier, a tier someone RAISED
 * (a second assessor included), a sensitive or High path, a tier the tier
 * module reached on partial evidence (no kind cited, an unknown kind, an
 * uncited changed path, any warning) -- each selects `full`.
 * An ABSENT second assessment is not a raise: a local review never has one (the
 * assessor is a gate-mode step), and the tier module already keeps it from
 * lowering anything, so it neither selects `full` nor blocks `light`.
 * Light is the one answer that has to be earned; there is no default to it.
 */

const { SECURITY_REQUIRED_TIERS } = require('./pr-review-gate');
const { resolveDepth } = require('./pr-review-depth');

/** The closed set of modes, cheapest first. */
const MODES = Object.freeze(['light', 'full']);

/** Tier word -> mode, for the tiers the light mode covers. Anything else is full. */
const LIGHT_TIERS = Object.freeze(['low', 'medium']);

/** The tier words the tier module can emit. */
const KNOWN_TIERS = Object.freeze(['low', 'medium', 'high']);

/**
 * The tier module's own evidence flags. A record carrying one of these says the
 * tier was reached on missing or partial evidence, and the module contract is
 * that anything ambiguous selects `full`. `second-assessment-missing` and
 * `low-treated-as-medium` are deliberately NOT here: a local review never has a
 * second assessment and the waiver is off by default, so neither is ambiguity.
 */
const AMBIGUOUS_REASONS = Object.freeze(['no-kinds-cited', 'unknown-kind', 'uncited-path']);

/**
 * What a mode requires of the review, read from `depth` so there is one source
 * of the numbers. `light` follows the effective tier (Quick under the Low
 * waiver, Standard otherwise); `full` is Deep.
 */
function requiresFor(mode, effective) {
  const depth = mode === 'full'
    ? resolveDepth({ tier: 'high' })
    : resolveDepth({ tier: effective, effectiveTier: effective, lowWaiverEnabled: effective === 'low' });
  return { depth: depth.mode, minReviewers: depth.bounds.reviewers.min, verifiersPerFinding: depth.bounds.verifiers.min };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyList = (value) => Array.isArray(value) && value.length > 0;

/** Exact lowercase match only: a tier the module did not emit is not a tier this one reads. */
const tierWord = (value) => (typeof value === 'string' && KNOWN_TIERS.includes(value) ? value : null);

function full(reasons, tier, effectiveTier, ok) {
  return {
    ok,
    mode: 'full',
    tier,
    effectiveTier,
    securityLane: true,
    requires: requiresFor('full'),
    reasons,
  };
}

/**
 * Selects the review mode from a `tier` subcommand result.
 *
 * `ok:true` means the record was read without ambiguity (High is a clean
 * `full`); `ok:false` means the answer is `full` BECAUSE it could not be read.
 *
 * @param {Object} tierResult  The `tier` subcommand's output (a tier record plus `ok`).
 * @returns {{ok:boolean, mode:'light'|'full', tier:string|null, effectiveTier:string|null,
 *   securityLane:boolean, requires:{depth:string, minReviewers:number, verifiersPerFinding:number},
 *   reasons:string[]}}
 */
function selectMode(tierResult) {
  if (!isObject(tierResult)) return full(['unreadable-tier-result'], null, null, false);

  const tier = tierWord(tierResult.tier);
  const effective = tierWord(tierResult.effectiveTier);

  // --- Could the tier be read at all? -------------------------------------
  const unreadable = [];
  if (tierResult.ok !== true) unreadable.push('tier-result-not-ok');
  if (tier === null) unreadable.push('unknown-tier');
  if (effective === null) unreadable.push('unknown-effective-tier');
  // Raising the tier is the one direction the effective tier may move: Low may
  // read as Medium until the waiver is on. Any other disagreement is a record
  // that contradicts itself, and a contradiction is ambiguity.
  if (tier !== null && effective !== null) {
    const allowed = tier === effective || (tier === 'low' && effective === 'medium') || effective === 'high';
    if (!allowed) unreadable.push('tier-contradicts-effective-tier');
  }
  // A key the record should carry and does not is a partial object: nothing
  // can be said about what it left out.
  if (!Array.isArray(tierResult.raised)) unreadable.push('raised-unreadable');
  const paths = tierResult.paths;
  if (!isObject(paths) || !Array.isArray(paths.sensitive) || !Array.isArray(paths.high)) {
    unreadable.push('paths-unreadable');
  }
  // The tier's own evidence flags: a record is only as readable as the evidence
  // behind it. A tier reached with nothing cited, a kind it could not read or a
  // changed path no kind covers says nothing reliable about what it left out.
  if (!Array.isArray(tierResult.reasons)) unreadable.push('reasons-unreadable');
  if (!Array.isArray(tierResult.warnings)) unreadable.push('warnings-unreadable');
  if (isObject(paths) && !Array.isArray(paths.uncited)) unreadable.push('paths-unreadable');
  if (unreadable.length > 0) return full(unreadable, tier, effective, false);

  const ambiguous = [];
  if (isNonEmptyList(tierResult.reasons)) {
    for (const reason of AMBIGUOUS_REASONS) if (tierResult.reasons.includes(reason)) ambiguous.push(reason);
  }
  if (paths.uncited.length > 0 && !ambiguous.includes('uncited-path')) ambiguous.push('uncited-path');
  // Every warning the tier module emits (invalid-kind-record, invalid-kind-paths,
  // invalid-changed-paths, non-verbatim-changed-path, unreadable-policy, ...)
  // names input it could not read.
  for (const warning of tierResult.warnings) ambiguous.push(`tier-warning:${typeof warning === 'string' ? warning : 'unreadable'}`);
  if (ambiguous.length > 0) return full(ambiguous, tier, effective, false);

  // --- Readable, and still not light ---------------------------------------
  const reasons = [];
  if (tierResult.raised.length > 0) reasons.push('tier-raised');
  if (isNonEmptyList(paths.sensitive)) reasons.push('sensitive-path');
  if (isNonEmptyList(paths.high)) reasons.push('high-path');
  if (tier === 'high' || effective === 'high') reasons.push('high-tier');
  if (reasons.length > 0) return full(reasons, tier, effective, true);

  const reachable = LIGHT_TIERS.includes(tier) && LIGHT_TIERS.includes(effective);
  if (!reachable) return full(['tier-not-light'], tier, effective, false);

  return {
    ok: true,
    mode: 'light',
    tier,
    effectiveTier: effective,
    // The gate asks for the security lane at Medium and High. Light keeps it.
    securityLane: SECURITY_REQUIRED_TIERS.includes(tier) || SECURITY_REQUIRED_TIERS.includes(effective),
    requires: requiresFor('light', effective),
    reasons: [`${effective}-tier`],
  };
}

module.exports = { selectMode, MODES };
