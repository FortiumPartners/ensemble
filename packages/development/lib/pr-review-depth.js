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
 * The number of DISTINCT reviewers a plan has: the whole number it is, or the count of distinct names in the
 * assignment list itself (`[{ reviewer, sliceId, lens }]`, what `planSlices` returns as `reviewerAssignments`
 * and what `reviewedBy` carries). With the review sharded by slice and lens one reviewer is one (slice, lens)
 * pass, so the floor "at least two reviewers" is graded on the plan that will actually be dispatched, not on a
 * number typed beside it. An empty list is zero reviewers (what a refused plan carries); anything unreadable is
 * `null`.
 */
function distinctReviewers(value) {
  if (isCount(value)) return value;
  if (!Array.isArray(value)) return null;
  const names = new Set();
  for (const entry of value) {
    if (!isObject(entry) || !isText(entry.reviewer)) return null;
    names.add(entry.reviewer.trim().toLowerCase());
  }
  return names.size;
}

/**
 * Grades planned and used reviewer/verifier counts against the mode's bounds
 * (AC-016-1). Each set given is graded on its own, so a plan that respected
 * the mode and a run that did not are both visible.
 *
 * @param {Object} input
 * @param {string} input.mode
 * @param {{reviewers:number|Array<{reviewer:string}>, verifiers:number|Array<{id:string, verifiers:string[]}>, candidates?:number}} [input.planned]
 * @param {{reviewers:number|Array<{reviewer:string}>, verifiers:number|Array<{id:string, verifiers:string[]}>, candidates?:number}} [input.used]
 *   `reviewers` is the number of distinct reviewers, or the assignment list (`planSlices`' `reviewerAssignments`,
 *   `verifyCoverage`'s `reviewedBy`) counted by its distinct reviewer names; see `distinctReviewers`.
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
    if (!isObject(counts) || distinctReviewers(counts.reviewers) === null || perCandidateVerifiers(counts.verifiers, counts.candidates) === null) {
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
      { reviewers: distinctReviewers(counts.reviewers), verifiers: perCandidateVerifiers(counts.verifiers, counts.candidates).count, vacuous },
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
  return {
    ok: false,
    reason,
    sliced: false,
    slices: [],
    reviewerAssignments: [],
    lenses: [],
    lensesPerSlice: 0,
    uncovered: [],
    threshold: DEFAULT_SLICE_THRESHOLD,
    totalLines: 0,
    warnings: [],
  };
}

/**
 * What a reviewer is asked to emphasise, in priority order. The FIRST lens is on every slice; the others rotate
 * across slices so each is used about equally. A caller may pass its own pool as `lenses`; nothing in the policy
 * block of REVIEW.md feeds one today, so this default is the only source in practice.
 */
const DEFAULT_LENSES = Object.freeze(['correctness', 'security', 'tests', 'docs-mirrors']);

/**
 * A lens is a token from a closed grammar, never a sentence: it is carried into reviewer names, brief inputs and
 * result file names. Lower case, so "Security" and "security" are one lens, not two. `collect` checks the lens of
 * every reviewer it is given against this same pattern (exported for it), so a label the brief would refuse cannot
 * count as one more pass.
 */
const LENS_TOKEN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** How many slices a size-driven split may produce when the caller names a target but no ceiling. */
const DEFAULT_MAX_SLICES = 4;

/**
 * Distinct lenses every path must be read under. Standard and Deep need independent passes over each path (the
 * depth contract: at least two reviewers), and slicing alone would give each path ONE pass, so a path needs two
 * DIFFERENT lenses; Quick is one reviewer and one lens. A mode that is absent or unreadable is not Quick: absent
 * means the stricter two, and an unreadable one is `null` (refused by the callers).
 */
function lensFloor(mode) {
  if (mode === undefined) return { count: 2, mode: null };
  const known = fromSet(mode, MODES);
  return known === null ? null : { count: known === 'quick' ? 1 : 2, mode: known };
}

/** The lens pool as lower-case distinct tokens, or null when it cannot be read. */
function readLenses(value) {
  const raw = value === undefined ? DEFAULT_LENSES : value;
  if (!Array.isArray(raw) || !Array.from(raw).every(isText)) return null;
  const lenses = Array.from(raw).map((lens) => lens.trim().toLowerCase());
  if (!lenses.every((lens) => LENS_TOKEN.test(lens)) || new Set(lenses).size !== lenses.length) return null;
  return lenses;
}

/** `value` as an integer of at least 1, or null. */
const readPositive = (value) => (Number.isInteger(value) && value >= 1 ? value : null);

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

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const sumLines = (entries) => entries.reduce((sum, entry) => sum + entry.lines, 0);

/**
 * Contiguous runs of `entries` (already in path order), none over `limit` lines and none holding more than `maxFiles`
 * entries, unless one entry alone is over the line limit (a path is never cut).
 */
function greedyChunks(entries, limit, maxFiles = Infinity) {
  const chunks = [];
  let current = null;
  for (const entry of entries) {
    if (current === null || current.lines + entry.lines > limit || current.entries.length >= maxFiles) {
      current = { entries: [], lines: 0 };
      chunks.push(current);
    }
    current.entries.push(entry);
    current.lines += entry.lines;
  }
  return chunks;
}

/**
 * `entries` cut into at most `count` contiguous runs, as even as contiguity allows: the smallest line limit that
 * still fits in `count` runs. Contiguous in path order, so a chunk is a set of neighbouring files a reviewer can
 * hold in mind, not a scatter that balances line counts. A `maxFiles` limit that `count` runs cannot honour (the slice
 * ceiling binds) is dropped, and the runs are balanced by lines alone: the count wins, because it is the number of agents.
 */
function balancedChunks(entries, count, maxFiles = Infinity) {
  const files = Math.ceil(entries.length / maxFiles) <= count ? maxFiles : Infinity;
  let low = entries.reduce((max, entry) => Math.max(max, entry.lines), 0);
  let high = sumLines(entries);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (greedyChunks(entries, mid, files).length <= count) high = mid;
    else low = mid + 1;
  }
  return greedyChunks(entries, low, files);
}

/**
 * Cuts the base slices (one per area, or the whole PR) by size: every base is split into runs of about
 * `targetLines` (and of at most `maxFiles` paths), and the total is held to `maxSlices` by merging the smallest bases
 * once there are too many and by coarsening the cheapest splits first. A path is never cut (one huge file stays one
 * slice's whole), and every path stays in exactly one slice.
 */
function sizeSplit(bases, targetLines, maxSlices, maxFiles = Infinity) {
  let groups = bases.map((base) => ({ ...base, merged: false }));
  while (groups.length > maxSlices) {
    groups.sort((a, b) => a.lines - b.lines || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const [first, second, ...rest] = groups;
    groups = [
      ...rest,
      { id: null, area: '', entries: [...first.entries, ...second.entries].sort(byPath), lines: first.lines + second.lines, merged: true },
    ];
  }
  groups.sort((a, b) => (a.area < b.area ? -1 : a.area > b.area ? 1 : 0) || byPath(a.entries[0] || { path: '' }, b.entries[0] || { path: '' }));
  let mergedCount = 0;
  for (const group of groups) if (group.merged) group.id = `mixed~${(mergedCount += 1)}`;

  const counts = groups.map((group) => (group.entries.length === 0 ? 1 : greedyChunks(group.entries, targetLines, maxFiles).length));
  let total = counts.reduce((sum, count) => sum + count, 0);
  while (total > maxSlices) {
    let pick = -1;
    let pickLoad = Infinity;
    counts.forEach((count, index) => {
      if (count > 1 && groups[index].lines / (count - 1) < pickLoad) {
        pick = index;
        pickLoad = groups[index].lines / (count - 1);
      }
    });
    if (pick === -1) break;
    counts[pick] -= 1;
    total -= 1;
  }

  const slices = [];
  groups.forEach((group, index) => {
    const chunks = counts[index] === 1 ? [{ entries: group.entries, lines: group.lines }] : balancedChunks(group.entries, counts[index], maxFiles);
    chunks.forEach((chunk, position) => {
      slices.push({
        id: chunks.length === 1 ? group.id : `${group.id}~${position + 1}`,
        area: group.area,
        paths: chunk.entries.map((entry) => entry.path),
        lines: chunk.lines,
      });
    });
  });
  return slices;
}

/**
 * Crosses every slice with the lenses it is read under: `perSlice` distinct lenses each, the first lens on every
 * slice and the rest taken from the others in rotation (slice i starts at the i-th of the others), so within one
 * slice no lens repeats. One reviewer is one (slice, lens) pass, named `s<slice number>-<lens>`. A Quick review is
 * ONE reviewer under the first lens, and `planSlices` hands it ONE slice: a reviewer is briefed with one slice and
 * writes one result file, so one name over two slices could not be dispatched or collected.
 */
function assignReviewers(slices, lenses, perSlice, quick) {
  if (quick) return slices.map((slice) => ({ reviewer: `r1-${lenses[0]}`, sliceId: slice.id, lens: lenses[0] }));
  const rest = lenses.slice(1);
  const assignments = [];
  slices.forEach((slice, index) => {
    const chosen = [lenses[0]];
    for (let offset = 0; offset < perSlice - 1; offset += 1) chosen.push(rest[(index + offset) % rest.length]);
    for (const lens of chosen) assignments.push({ reviewer: `s${index + 1}-${lens}`, sliceId: slice.id, lens });
  });
  return assignments;
}

/**
 * Plans the review slices for a PR and who reads them (AC-018-1, plan 3A).
 *
 * Below the threshold the PR is one slice. Above it, paths are partitioned on
 * the sensitive-area and rules boundaries the caller supplies (the longest
 * containing area wins, and everything else falls to the repository root
 * slice). With `targetLines` every slice is then cut by SIZE, below the threshold too, because a
 * PR that is one area (or one slice under the threshold) is still too much for one agent to read. Either way every
 * changed path appears in EXACTLY one slice. At Quick the PR is always ONE slice, whatever its size: the threshold
 * and the size cut exist to share a large PR between reviewers, and Quick is one reviewer.
 *
 * Slicing alone breaks the depth contract: disjoint slices give each path ONE pass where Standard and Deep need
 * at least two independent ones. So every slice is also crossed with at least two DIFFERENT lenses
 * (`reviewerAssignments`), and `verifyCoverage` counts distinct lenses per path.
 *
 * @param {Object} input
 * @param {Array<{path:string, lines:number}>} input.paths  One entry per changed path, spelled exactly as the
 *   caller's `changedPaths` spells it (`git diff --numstat -z --no-renames`: a move is two entries, the deleted
 *   name and the added one), because `verifyCoverage` matches them name for name.
 * @param {string[]} [input.areas]    Area roots: the directories holding REVIEW.md files and sensitive areas.
 * @param {number} [input.threshold]  Changed lines above which the PR is sliced by area; defaults to 1500. Ignored at
 *   Quick.
 * @param {number} [input.targetLines]  Lines per slice to aim for; absent means no size-driven split. Ignored at Quick.
 * @param {number} [input.maxFiles]   Most paths one slice of a size-driven split may hold: a slice is closed once it holds
 *   that many, however few lines they are (a reviewer must reach every path, and each path costs at least a read). Like
 *   `maxSlices` it applies ONLY together with `targetLines`, and it gives way to `maxSlices`: when the slice ceiling cannot
 *   hold every path at that many to a slice, the slices are balanced by lines alone (the number of agents wins). Ignored at Quick.
 * @param {number} [input.maxSlices]  Most slices a size-driven split may produce (default 4 once `targetLines` is
 *   given); smaller bases are merged into `mixed~N` slices to hold it. It applies ONLY together with `targetLines`:
 *   without one the slices are one per area above the threshold, with no cap, and each is read under at least two
 *   lenses at Standard and Deep (ten areas are ten slices and twenty reviewers). Ignored at Quick.
 * @param {string} [input.mode]       `quick`, `standard` or `deep`: Quick is one reviewer, one lens, one slice (never
 *   cut by area or size); absent means the stricter two lenses.
 * @param {string[]} [input.lenses]   The lens pool, first = on every slice; defaults to `DEFAULT_LENSES`.
 * @param {number} [input.lensesPerSlice]  Distinct lenses per slice, at least the mode's floor (two at Standard and
 *   Deep) and at most the pool; how a larger reviewer count (`REVIEWER_COUNT`) is spent.
 * @returns {{ok:boolean, sliced:boolean, slices:Array<{id:string, area:string, paths:string[], lines:number}>,
 *   reviewerAssignments:Array<{reviewer:string, sliceId:string, lens:string}>, lenses:string[], lensesPerSlice:number,
 *   uncovered:string[], threshold:number, totalLines:number, warnings:string[], reason?:string}}
 */
function planSlices(input) {
  if (!isObject(input)) return sliceFailure('invalid-input');
  const { paths } = input;
  if (!Array.isArray(paths)) return sliceFailure('paths must be an array');

  const floor = lensFloor(input.mode);
  if (floor === null) return sliceFailure('unknown-mode');
  const quick = floor.mode === 'quick';
  const lenses = readLenses(input.lenses);
  if (lenses === null) return sliceFailure('lenses must be distinct tokens (lower case letters, digits and "-", at most 32 characters)');
  let perSlice = floor.count;
  if (input.lensesPerSlice !== undefined) {
    perSlice = readPositive(input.lensesPerSlice);
    if (perSlice === null || perSlice < floor.count) return sliceFailure(`lensesPerSlice must be a whole number of at least ${floor.count}`);
    if (quick && perSlice > 1) return sliceFailure('lensesPerSlice above 1 exceeds the Quick ceiling of one reviewer');
  }
  if (lenses.length < perSlice) return sliceFailure(`lenses must name at least ${perSlice} distinct lenses to read every path under ${perSlice}`);

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
  let targetLines = null;
  if (input.targetLines !== undefined) {
    targetLines = readPositive(input.targetLines);
    if (targetLines === null) warnings.push('invalid-target-lines');
  }
  let maxFiles = Infinity;
  if (input.maxFiles !== undefined) {
    const read = readPositive(input.maxFiles);
    if (read === null) warnings.push('invalid-max-files');
    else maxFiles = read;
  }
  let maxSlices = DEFAULT_MAX_SLICES;
  if (input.maxSlices !== undefined) {
    const read = readPositive(input.maxSlices);
    if (read === null) warnings.push('invalid-max-slices');
    else maxSlices = read;
  }

  const totalLines = entries.reduce((sum, entry) => sum + entry.lines, 0);
  // Quick is ONE reviewer, and a reviewer is briefed with ONE slice and writes ONE result file, so a Quick plan is
  // one slice however large the PR is. Cut by area it would hand one reviewer name to several slices, which `collect`
  // refuses (a name listed twice): a documented mode could not finish on a PR over the threshold.
  const overThreshold = !quick && totalLines > threshold;

  let bases;
  if (!overThreshold) {
    bases = [{ id: 'whole-pr', area: '', entries: entries.slice().sort(byPath), lines: totalLines }];
  } else {
    const byArea = new Map();
    for (const entry of entries) {
      const area = areaFor(entry.normalized, areas);
      if (!byArea.has(area)) byArea.set(area, { id: area === '' ? '(repository root)' : area, area, entries: [], lines: 0 });
      const base = byArea.get(area);
      base.entries.push(entry);
      base.lines += entry.lines;
    }
    bases = [...byArea.values()].sort((a, b) => (a.area < b.area ? -1 : a.area > b.area ? 1 : 0));
    for (const base of bases) base.entries.sort(byPath);
  }

  let slices;
  if (targetLines !== null && !quick) {
    slices = sizeSplit(bases, targetLines, maxSlices, maxFiles);
  } else {
    slices = bases.map((base) => ({ id: base.id, area: base.area, paths: base.entries.map((entry) => entry.path), lines: base.lines }));
  }
  if (new Set(slices.map((slice) => slice.id)).size !== slices.length) return sliceFailure('slice ids collide');

  return {
    ok: true,
    sliced: overThreshold || slices.length > 1,
    slices,
    reviewerAssignments: assignReviewers(slices, lenses, perSlice, quick),
    lenses,
    lensesPerSlice: perSlice,
    uncovered: [],
    threshold,
    totalLines,
    warnings,
  };
}

function coverageFailure(reason) {
  return {
    ok: false,
    reason,
    covered: false,
    uncovered: [],
    underReviewed: [],
    requiredLenses: 0,
    reviewedSlices: [],
    unreviewedSlices: [],
    unknownReviewed: [],
  };
}

/**
 * Checks that every changed path was read under enough DIFFERENT lenses (AC-018-2, plan 3A), and names every path
 * that was not.
 *
 * A path is covered only when the reviewers that read it, between them, used at least the mode's number of distinct
 * lenses (two at Standard and Deep, one at Quick). A reviewer read a path when its entry NAMES the path in `paths`
 * (and a slice holding that path is the reviewer's own): the lens is credited to those paths and to no others,
 * because a slice only says which paths a reviewer was assigned, never which it read. Crediting the whole slice
 * because one of its reviewers arrived would let a reviewer whose list was shorter than its slice cover files nobody
 * read. Two reviewers with the SAME lens are one pass seen twice, not two independent ones, so they do not count; a
 * path read under one lens is `underReviewed`, never `covered`. A reviewer holds ONE lens (it is in the reviewer's
 * brief): the same reviewer reported under two lenses is refused, because it would otherwise count as two passes.
 *
 * @param {Object} input
 * @param {Array<{id:string, paths:string[]}>} input.slices
 * @param {Array<{sliceId:string, lens:string, reviewer:string, paths:string[]}>} input.reviewedBy  One entry per
 *   reviewer that arrived and covered its slice (`collect` returns this); a reviewer that did not is simply absent.
 *   `paths` are the paths of the slice the reviewer read and reported: its lens counts toward THOSE paths only.
 *   An entry without a non-empty `paths` list is refused: it would credit nothing, or the whole slice.
 * @param {string} [input.mode]            `quick` (one lens suffices) | `standard` | `deep`; absent means two.
 * @param {string[]} [input.changedPaths]  Every changed path, when the caller
 *   wants a path the plan never held to count as uncovered too. An uncovered
 *   path with no unreviewed slice is one the plan never held: its `paths` were
 *   not cut from the same listing as these.
 * @returns {{ok:boolean, covered:boolean, uncovered:string[], underReviewed:Array<{path:string, lenses:string[]}>,
 *   requiredLenses:number, reviewedSlices:string[], unreviewedSlices:string[], unknownReviewed:string[], reason?:string}}
 *   `uncovered`: paths no reviewer read at all (an unreviewed slice, or a path the plan never held).
 *   `underReviewed`: every path with fewer distinct lenses than required, none included (`lenses: []`): a path of a
 *   reviewed slice that no reviewer's `paths` names is one of those.
 */
function verifyCoverage(input) {
  if (!isObject(input)) return coverageFailure('invalid-input');
  const { slices, reviewedBy } = input;
  if (!Array.isArray(slices)) return coverageFailure('slices must be an array');
  if (!Array.isArray(reviewedBy)) return coverageFailure('reviewedBy must be an array of { sliceId, lens, reviewer, paths }');
  const floor = lensFloor(input.mode);
  if (floor === null) return coverageFailure('unknown-mode');

  const plan = [];
  for (const slice of Array.from(slices)) {
    if (!isObject(slice) || !isText(slice.id) || !Array.isArray(slice.paths)) {
      return coverageFailure('each slice must be { id, paths[] }');
    }
    if (!slice.paths.every((path) => isText(path))) return coverageFailure('slice paths must be non-empty strings');
    plan.push({ id: slice.id, paths: slice.paths.slice() });
  }

  const lensOfReviewer = new Map();
  const readBySlice = new Map(); // slice id -> one { lens, paths: Set } per `reviewedBy` entry for that slice
  for (const entry of Array.from(reviewedBy)) {
    if (
      !isObject(entry) ||
      !isText(entry.sliceId) ||
      !isText(entry.lens) ||
      !isText(entry.reviewer) ||
      !Array.isArray(entry.paths) ||
      entry.paths.length === 0 ||
      !entry.paths.every(isText)
    ) {
      return coverageFailure('each reviewedBy entry must be { sliceId, lens, reviewer, paths } with non-empty strings and at least one path');
    }
    const lens = entry.lens.trim().toLowerCase();
    const reviewer = entry.reviewer.trim().toLowerCase();
    if (lensOfReviewer.has(reviewer) && lensOfReviewer.get(reviewer) !== lens) {
      return coverageFailure(`reviewer ${JSON.stringify(entry.reviewer)} is reported under two lenses: a reviewer holds one lens, so it is one pass`);
    }
    lensOfReviewer.set(reviewer, lens);
    const sliceId = entry.sliceId.trim();
    if (!readBySlice.has(sliceId)) readBySlice.set(sliceId, []);
    readBySlice.get(sliceId).push({ lens, paths: new Set(entry.paths) });
  }

  const sliceIds = new Set(plan.map((slice) => slice.id));
  const unreviewedSlices = plan.filter((slice) => !readBySlice.has(slice.id)).map((slice) => slice.id);
  const uncovered = plan.filter((slice) => !readBySlice.has(slice.id)).flatMap((slice) => slice.paths);

  // The plan says which paths a slice holds; the lens of a reviewer is credited to a path only when that reviewer's
  // own list names it.
  const lensesByPath = new Map();
  for (const slice of plan) {
    for (const path of slice.paths) {
      if (!lensesByPath.has(path)) lensesByPath.set(path, new Set());
      for (const read of readBySlice.get(slice.id) || []) {
        if (read.paths.has(path)) lensesByPath.get(path).add(read.lens);
      }
    }
  }

  if (input.changedPaths !== undefined) {
    if (!Array.isArray(input.changedPaths) || !input.changedPaths.every((path) => isText(path))) {
      return coverageFailure('changedPaths must be an array of non-empty strings');
    }
    for (const path of input.changedPaths) {
      if (!lensesByPath.has(path)) {
        lensesByPath.set(path, new Set());
        if (!uncovered.includes(path)) uncovered.push(path);
      }
    }
  }

  const underReviewed = [];
  for (const [path, lenses] of lensesByPath) {
    if (lenses.size < floor.count) underReviewed.push({ path, lenses: [...lenses].sort() });
  }

  return {
    ok: true,
    covered: uncovered.length === 0 && underReviewed.length === 0,
    uncovered,
    underReviewed,
    requiredLenses: floor.count,
    reviewedSlices: plan.filter((slice) => readBySlice.has(slice.id)).map((slice) => slice.id),
    unreviewedSlices,
    unknownReviewed: [...readBySlice.keys()].filter((id) => !sliceIds.has(id)),
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
  DEFAULT_LENSES,
  DEFAULT_MAX_SLICES,
  LENS_TOKEN,
};
