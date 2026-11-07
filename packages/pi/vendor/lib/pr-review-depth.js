'use strict';

/**
 * Review depth: mode resolution, reviewer/verifier bounds, area slicing and
 * slice coverage (TRD-017, REQ-016 and REQ-018).
 *
 * NO side effects, NO shell, NO network, NO file reads. Pure functions over
 * plain JSON, the same contract as the rest of the pr-review-* libraries.
 *
 * Three modes, in order of effort: `quick`, `standard`, `deep`.
 *   - Quick is a CEILING: one reviewer, no verifier. Exceeding it is a
 *     violation, which is what keeps "Quick" from quietly becoming Deep.
 *   - Standard and Deep are FLOORS: at least two reviewers, and 3 and 5
 *     verifiers. Running fewer is a violation; running more is allowed.
 * What each mode MEANS is editable policy (AC-016-2): a caller may pass its
 * own `bounds` from the policy block, and only Quick's ceiling is fixed here.
 *
 * FAIL CLOSED, which for review depth means MORE review, never less:
 *   - a tier this module cannot read resolves to `deep`, with `ok:false`;
 *   - a request shape it cannot read is a violation, never zero violations;
 *   - a plan it cannot read is no plan at all, never one safe slice;
 *   - coverage it cannot verify is never full coverage.
 */

/** The closed set of modes, cheapest first. */
const MODES = Object.freeze(['quick', 'standard', 'deep']);

/** The tier a PR gets when nothing readable says otherwise: the deepest review. */
const FALLBACK_MODE = 'deep';

/**
 * The bounds the PRD fixes (AC-016-1). `max: null` means "no ceiling": a
 * Standard review may run more than the minimum, it may not run fewer.
 */
const DEFAULT_BOUNDS = Object.freeze({
  quick: Object.freeze({
    reviewers: Object.freeze({ min: 1, max: 1 }),
    verifiers: Object.freeze({ min: 0, max: 0 }),
  }),
  standard: Object.freeze({
    reviewers: Object.freeze({ min: 2, max: null }),
    verifiers: Object.freeze({ min: 3, max: null }),
  }),
  deep: Object.freeze({
    reviewers: Object.freeze({ min: 2, max: null }),
    verifiers: Object.freeze({ min: 5, max: null }),
  }),
});

/** Quick's ceiling is not negotiable: a policy may not raise it (AC-016-2 bound). */
const QUICK_CEILING = Object.freeze({ reviewers: 1, verifiers: 0 });

/** Changed lines above which a PR is reviewed by area (AC-018-1). */
const DEFAULT_SLICE_THRESHOLD = 1500;

/** Tier -> mode, before the Low-is-treated-as-Medium rule (REQ-013) applies. */
const TIER_MODE = Object.freeze({ low: 'quick', medium: 'standard', high: 'deep' });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isCount = (value) => Number.isInteger(value) && value >= 0;

/** A word from a closed set, compared the way the ledger compares severities: letter case only. */
function fromSet(value, set) {
  if (typeof value !== 'string') return null;
  const key = value.toLowerCase();
  return set.includes(key) ? key : null;
}

/**
 * Resolves the review depth for a PR (AC-016-3).
 *
 * The mode defaults from the tier -- Low=Quick, Medium=Standard, High=Deep --
 * but a Low PR is treated as Medium (and so gets Standard) until the Low
 * waiver is enabled, which is the strict default of REQ-013. An explicit
 * `requested` mode wins; when it asks for less review than the tier default,
 * that is recorded in `reasons` so the report can show it.
 *
 * @param {Object} input
 * @param {string} input.tier                  `low` | `medium` | `high`.
 * @param {string} [input.effectiveTier]       The recorded effective tier, when there is one; it wins over `tier`.
 * @param {string} [input.requested]           An explicit mode.
 * @param {boolean} [input.lowWaiverEnabled]   Exactly `true` lets a Low PR be Quick.
 * @returns {{ok:boolean, mode:string, tier:string|null, source:'tier'|'requested', bounds:Object,
 *   reasons:string[], warnings:string[]}}
 */
function resolveDepth(input) {
  const reasons = [];
  const warnings = [];
  const request = isObject(input) ? input : {};
  if (!isObject(input)) {
    reasons.push('invalid-input');
    reasons.push('unknown-tier');
  }

  const declared = isText(request.effectiveTier) ? request.effectiveTier : request.tier;
  let tier = fromSet(declared, Object.keys(TIER_MODE));
  let ok = true;

  if (tier === null) {
    if (!reasons.includes('unknown-tier')) reasons.push('unknown-tier');
    ok = false;
    tier = null;
  } else if (tier === 'low' && request.lowWaiverEnabled !== true) {
    // REQ-013: Low is Medium until a code owner enables the waiver.
    tier = 'medium';
    reasons.push('low-treated-as-medium');
  }

  let mode = tier === null ? FALLBACK_MODE : TIER_MODE[tier];
  let source = 'tier';

  if (request.requested !== undefined && request.requested !== null && request.requested !== '') {
    const requested = fromSet(request.requested, MODES);
    if (requested === null) {
      warnings.push('unknown-requested-mode');
    } else {
      if (MODES.indexOf(requested) < MODES.indexOf(mode)) reasons.push('requested-below-tier-default');
      mode = requested;
      source = 'requested';
    }
  }

  return { ok, mode, tier, source, bounds: boundsFor(mode, undefined).bounds, reasons, warnings };
}

/** One role's bound, or null when the override cannot be read. */
function readBound(value, fallback) {
  if (value === undefined) return fallback;
  if (!isObject(value)) return null;
  const min = value.min === undefined ? fallback.min : value.min;
  const max = value.max === undefined ? fallback.max : value.max;
  if (!isCount(min)) return null;
  if (max !== null && !isCount(max)) return null;
  if (max !== null && max < min) return null;
  return { min, max };
}

/**
 * The bounds in force for a mode: the defaults, with a readable policy
 * override applied. Quick's ceiling is clamped back to one reviewer and no
 * verifier whatever the override says, and the clamp is reported.
 *
 * Exported because a caller that has not planned any reviewers yet still
 * needs the bounds the policy puts it under (TRD-018's `depth` subcommand):
 * an override nobody can read answers `{ bounds: null }`, never the defaults
 * standing in for it.
 */
function boundsFor(mode, override) {
  const base = DEFAULT_BOUNDS[mode];
  const warnings = [];
  if (override === undefined) return { bounds: { reviewers: { ...base.reviewers }, verifiers: { ...base.verifiers } }, warnings };
  if (!isObject(override)) return { bounds: null, warnings: ['invalid-bounds'] };

  const modeOverride = isObject(override[mode]) ? override[mode] : {};
  const reviewers = readBound(modeOverride.reviewers, base.reviewers);
  const verifiers = readBound(modeOverride.verifiers, base.verifiers);
  if (reviewers === null || verifiers === null) return { bounds: null, warnings: ['invalid-bounds'] };

  const bounds = { reviewers: { ...reviewers }, verifiers: { ...verifiers } };
  if (mode === 'quick') {
    for (const role of ['reviewers', 'verifiers']) {
      const ceiling = QUICK_CEILING[role];
      if (bounds[role].max === null || bounds[role].max > ceiling) {
        bounds[role].max = ceiling;
        warnings.push('quick-bound-exceeded');
      }
      if (bounds[role].min > ceiling) {
        bounds[role].min = ceiling;
        warnings.push('quick-bound-exceeded');
      }
    }
  }
  return { bounds, warnings: [...new Set(warnings)] };
}

function boundsFailure(reason, warnings = []) {
  return {
    ok: false,
    reason,
    mode: null,
    bounds: null,
    violations: [{ set: 'request', role: null, kind: 'unreadable-request', bound: null, count: null, reason }],
    warnings,
  };
}

/**
 * The number of DISTINCT verifiers a candidate has, which is what the bounds mean by `verifiers`: the floor is
 * "how many independent verifiers settle each candidate", never how many agents were dispatched in total.
 * With the verification split into small per-candidate batches (`verify-assign`) 11 candidates x 3 verifiers
 * can mean 33 agents, and counting those against a floor of 3 would pass a plan whose every candidate had only
 * two verifiers.
 *
 * `value` is either that per-candidate count as a whole number, or the assignment list itself
 * (`[{ id, verifiers: [name] }]`, what `planVerification` returns), graded as its WEAKEST candidate: the
 * minimum distinct verifier count. A list naming no candidate counts as ZERO verifiers: an empty list is
 * what a refused plan carries, and it must never pass a floor (`checkBounds` makes the single exception,
 * a plan that states it was made for zero candidates). When `candidates` is given and the list names fewer
 * candidates than that, the unlisted ones have zero verifiers, so the weakest is zero. Anything else cannot
 * be read: `null`.
 */
function perCandidateVerifiers(value, candidates) {
  if (isCount(value)) return { count: value };
  if (!Array.isArray(value)) return null;
  let weakest = value.length === 0 || (isCount(candidates) && value.length < candidates) ? 0 : null;
  for (const entry of value) {
    if (!isObject(entry) || !Array.isArray(entry.verifiers) || !entry.verifiers.every(isText)) return null;
    const distinct = new Set(entry.verifiers.map((name) => name.trim().toLowerCase())).size;
    weakest = weakest === null ? distinct : Math.min(weakest, distinct);
  }
  return { count: weakest };
}

/**
 * Grades planned and used reviewer/verifier counts against the mode's bounds
 * (AC-016-1). Each set given is graded on its own, so a plan that respected
 * the mode and a run that did not are both visible.
 *
 * @param {Object} input
 * @param {string} input.mode
 * @param {{reviewers:number, verifiers:number|Array<{id:string, verifiers:string[]}>, candidates?:number}} [input.planned]
 * @param {{reviewers:number, verifiers:number|Array<{id:string, verifiers:string[]}>, candidates?:number}} [input.used]
 *   `verifiers` is the number of distinct verifiers PER CANDIDATE (or the assignment list, graded as its
 *   weakest candidate); see `perCandidateVerifiers`. `candidates` is how many candidates the round had
 *   (`verify-assign` returns it): with `candidates: 0` and an empty list the verifier floor is vacuous (nothing
 *   to verify), and a list naming fewer candidates than `candidates` grades the missing ones as zero verifiers.
 * @param {Object} [input.bounds]  Policy override, by mode.
 * @returns {{ok:boolean, mode:string|null, bounds:Object|null,
 *   violations:Array<{set:string, role:string|null, kind:string, bound:number|null, count:number|null}>,
 *   warnings:string[], reason?:string}}
 */
function checkBounds(input) {
  if (!isObject(input)) return boundsFailure('invalid-input');

  const mode = fromSet(input.mode, MODES);
  if (mode === null) return boundsFailure('unknown-mode');

  const { bounds, warnings } = boundsFor(mode, input.bounds);
  if (bounds === null) return boundsFailure('invalid-bounds', warnings);

  const sets = [];
  for (const name of ['planned', 'used']) {
    const counts = input[name];
    if (counts === undefined) continue;
    if (!isObject(counts) || !isCount(counts.reviewers) || perCandidateVerifiers(counts.verifiers, counts.candidates) === null) {
      return boundsFailure(`${name} counts must be whole numbers of reviewers and verifiers`, warnings);
    }
    if (counts.candidates !== undefined && !isCount(counts.candidates)) {
      return boundsFailure(`${name} candidates must be a whole number when given`, warnings);
    }
    // The ONE vacuous case: the plan says it was made for zero candidates AND lists no assignment. An empty
    // list without that statement is what a refused plan carries, and it still counts as zero verifiers.
    const vacuous = counts.candidates === 0 && Array.isArray(counts.verifiers) && counts.verifiers.length === 0;
    sets.push([
      name,
      { reviewers: counts.reviewers, verifiers: perCandidateVerifiers(counts.verifiers, counts.candidates).count, vacuous },
    ]);
  }
  if (sets.length === 0) return boundsFailure('no planned or used counts to grade', warnings);

  const violations = [];
  for (const [name, counts] of sets) {
    for (const role of ['reviewers', 'verifiers']) {
      // A round with zero candidates has nothing to verify: the verifier floor is vacuous there.
      if (role === 'verifiers' && counts.vacuous) continue;
      const bound = bounds[role];
      const count = counts[role];
      if (bound.max !== null && count > bound.max) {
        violations.push({ set: name, role, kind: 'exceeds-maximum', bound: bound.max, count });
      } else if (count < bound.min) {
        violations.push({ set: name, role, kind: 'below-minimum', bound: bound.min, count });
      }
    }
  }

  return { ok: violations.length === 0 && warnings.length === 0, mode, bounds, violations, warnings };
}

function sliceFailure(reason) {
  return { ok: false, reason, sliced: false, slices: [], uncovered: [], threshold: DEFAULT_SLICE_THRESHOLD, totalLines: 0, warnings: [] };
}

/** Drops `./` and trailing slashes so an area and a path compare on the same shape. */
function normalizePath(value) {
  return String(value).trim().replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
}

/** The longest area that contains `path`, or '' for the repository root. */
function areaFor(path, areas) {
  let best = '';
  for (const area of areas) {
    if (area === '') continue;
    if (path === area || path.startsWith(`${area}/`)) {
      if (area.length > best.length) best = area;
    }
  }
  return best;
}

/**
 * Plans the review slices for a PR (AC-018-1).
 *
 * Below the threshold the PR is one slice. Above it, paths are partitioned on
 * the sensitive-area and rules boundaries the caller supplies (the longest
 * containing area wins, and everything else falls to the repository root
 * slice), so every changed path appears in EXACTLY one slice.
 *
 * @param {Object} input
 * @param {Array<{path:string, lines:number}>} input.paths  One entry per changed path, spelled exactly as the
 *   caller's `changedPaths` spells it (`git diff --numstat -z --no-renames`: a move is two entries, the deleted
 *   name and the added one), because `verifyCoverage` matches them name for name.
 * @param {string[]} [input.areas]    Area roots: the directories holding REVIEW.md files and sensitive areas.
 * @param {number} [input.threshold]  Changed lines above which the PR is sliced; defaults to 1500.
 * @returns {{ok:boolean, sliced:boolean, slices:Array<{id:string, area:string, paths:string[], lines:number}>,
 *   uncovered:string[], threshold:number, totalLines:number, warnings:string[], reason?:string}}
 */
function planSlices(input) {
  if (!isObject(input)) return sliceFailure('invalid-input');
  const { paths } = input;
  if (!Array.isArray(paths)) return sliceFailure('paths must be an array');

  const entries = [];
  for (const entry of Array.from(paths)) {
    if (!isObject(entry) || !isText(entry.path) || !isCount(entry.lines)) {
      return sliceFailure('each path must be { path, lines } with a whole, non-negative line count');
    }
    entries.push({ path: entry.path, normalized: normalizePath(entry.path), lines: entry.lines });
  }
  if (new Set(entries.map((entry) => entry.normalized)).size !== entries.length) {
    return sliceFailure('a changed path appears more than once');
  }

  const rawAreas = input.areas === undefined ? [] : input.areas;
  if (!Array.isArray(rawAreas) || !Array.from(rawAreas).every((area) => isText(area))) {
    return sliceFailure('areas must be an array of non-empty strings');
  }
  const areas = Array.from(new Set(Array.from(rawAreas).map(normalizePath)));

  const warnings = [];
  let threshold = DEFAULT_SLICE_THRESHOLD;
  if (input.threshold !== undefined) {
    if (Number.isInteger(input.threshold) && input.threshold >= 1) {
      threshold = input.threshold;
    } else {
      warnings.push('invalid-threshold');
    }
  }

  const totalLines = entries.reduce((sum, entry) => sum + entry.lines, 0);
  if (totalLines <= threshold) {
    return {
      ok: true,
      sliced: false,
      slices: [{ id: 'whole-pr', area: '', paths: entries.map((entry) => entry.path), lines: totalLines }],
      uncovered: [],
      threshold,
      totalLines,
      warnings,
    };
  }

  const byArea = new Map();
  for (const entry of entries) {
    const area = areaFor(entry.normalized, areas);
    if (!byArea.has(area)) byArea.set(area, { id: area === '' ? '(repository root)' : area, area, paths: [], lines: 0 });
    const slice = byArea.get(area);
    slice.paths.push(entry.path);
    slice.lines += entry.lines;
  }

  const slices = [...byArea.values()].sort((a, b) => (a.area < b.area ? -1 : a.area > b.area ? 1 : 0));
  for (const slice of slices) slice.paths.sort();

  return { ok: true, sliced: true, slices, uncovered: [], threshold, totalLines, warnings };
}

function coverageFailure(reason) {
  return {
    ok: false,
    reason,
    covered: false,
    uncovered: [],
    reviewedSlices: [],
    unreviewedSlices: [],
    unknownReviewed: [],
  };
}

/**
 * Checks that every changed path was covered by a slice that was actually
 * reviewed (AC-018-2), and names every path that was not.
 *
 * @param {Object} input
 * @param {Array<{id:string, paths:string[]}>} input.slices
 * @param {string[]} input.reviewed        Slice ids that were reviewed.
 * @param {string[]} [input.changedPaths]  Every changed path, when the caller
 *   wants a path the plan never held to count as uncovered too. An uncovered
 *   path with no unreviewed slice is one the plan never held: its `paths` were
 *   not cut from the same listing as these.
 * @returns {{ok:boolean, covered:boolean, uncovered:string[], reviewedSlices:string[],
 *   unreviewedSlices:string[], unknownReviewed:string[], reason?:string}}
 */
function verifyCoverage(input) {
  if (!isObject(input)) return coverageFailure('invalid-input');
  const { slices, reviewed } = input;
  if (!Array.isArray(slices)) return coverageFailure('slices must be an array');
  if (!Array.isArray(reviewed)) return coverageFailure('reviewed must be an array of slice ids');

  const plan = [];
  for (const slice of Array.from(slices)) {
    if (!isObject(slice) || !isText(slice.id) || !Array.isArray(slice.paths)) {
      return coverageFailure('each slice must be { id, paths[] }');
    }
    if (!slice.paths.every((path) => isText(path))) return coverageFailure('slice paths must be non-empty strings');
    plan.push({ id: slice.id, paths: slice.paths.slice() });
  }
  if (!reviewed.every((id) => isText(id))) return coverageFailure('reviewed must contain only slice ids');

  const reviewedSet = new Set(Array.from(reviewed).map((id) => id.trim()));
  const sliceIds = new Set(plan.map((slice) => slice.id));

  const unreviewedSlices = plan.filter((slice) => !reviewedSet.has(slice.id)).map((slice) => slice.id);
  const uncovered = plan.filter((slice) => !reviewedSet.has(slice.id)).flatMap((slice) => slice.paths);

  if (input.changedPaths !== undefined) {
    if (!Array.isArray(input.changedPaths) || !input.changedPaths.every((path) => isText(path))) {
      return coverageFailure('changedPaths must be an array of non-empty strings');
    }
    const planned = new Set(plan.flatMap((slice) => slice.paths));
    for (const path of input.changedPaths) {
      if (!planned.has(path) && !uncovered.includes(path)) uncovered.push(path);
    }
  }

  return {
    ok: true,
    covered: uncovered.length === 0,
    uncovered,
    reviewedSlices: plan.filter((slice) => reviewedSet.has(slice.id)).map((slice) => slice.id),
    unreviewedSlices,
    unknownReviewed: [...reviewedSet].filter((id) => !sliceIds.has(id)),
  };
}

module.exports = {
  resolveDepth,
  checkBounds,
  planSlices,
  boundsFor,
  verifyCoverage,
  MODES,
  DEFAULT_BOUNDS,
  DEFAULT_SLICE_THRESHOLD,
};
