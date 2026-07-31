'use strict';

/**
 * complete-beads-planner.js
 *
 * Pure selection logic for the complete-beads goal loop.
 * NO side effects, NO shell, NO br/bv/git calls.
 *
 * Inputs:
 *   triageJson     — parsed bv --robot-triage --format json output
 *   planJson       — parsed bv --robot-plan --format json output
 *   readyBeads     — Array<{id, title}> from scoped br ready --json
 *   openBeads      — Array<{id, title}> all scoped open (non-closed) beads
 *   inProgressBeads— Array<{id, title}> scoped in_progress beads
 *   closedBeads    — Array<{id, title}> scoped closed beads
 *   slots          — number of worker slots (>= 1)
 *   phaseTaskIds   — PhaseTaskIds map {phaseN: [taskId, ...]} from phase-tracker
 *   opts           — {prFormat: boolean, scopePrefix: string}
 *
 * Returns:
 *   {
 *     selected:      [{id, track, position, deferReason}],
 *     deferred:      [{id, track, position, deferReason}],
 *     dispatchOrder: [beadId, ...],
 *     trackPositions:{[beadId]: {track, position}},
 *     blocked:       [{id, reason}]
 *   }
 *
 * Fail-closed invariants:
 *   - BV plan returning zero track items when ready work exists → throws
 *   - BV plan omitting any non-empty ready scope → throws
 *   - No br-ready fallback; br-ready feeds only the eligibility check
 */

const { selectNextTasks } = require('./phase-tracker');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the task-id suffix from a bead title.
 * Handles:
 *   [trd:my-trd:task:TRD-001] ...
 *   [trd:my-trd:task:AC-001] ...
 *   [trd:my-trd:task:XC-001] ...
 *   beads-042  (bare bead id — return as-is)
 */
function extractTaskId(beadTitle) {
  if (!beadTitle || typeof beadTitle !== 'string') return null;
  const match = beadTitle.match(/\[trd:[^\]]+:task:([^\]]+)\]/);
  return match ? match[1] : null;
}

/**
 * Build a Set of bead IDs currently in-flight (in_progress).
 */
function toInFlightSet(inProgressBeads) {
  const s = new Set();
  if (Array.isArray(inProgressBeads)) {
    for (const b of inProgressBeads) {
      if (b && b.id) s.add(b.id);
    }
  }
  return s;
}

/**
 * Intersect br-ready bead IDs with scoped open bead IDs.
 * Returns a Map<beadId, beadRecord> for currently-eligible beads.
 */
function eligibleMap(readyBeads, openBeads) {
  const openIds = new Set();
  if (Array.isArray(openBeads)) {
    for (const b of openBeads) {
      if (b && b.id) openIds.add(b.id);
    }
  }
  const map = new Map();
  if (Array.isArray(readyBeads)) {
    for (const b of readyBeads) {
      if (b && b.id && openIds.has(b.id)) {
        map.set(b.id, b);
      }
    }
  }
  return map;
}

/**
 * Collect all task IDs from closed beads.
 * Used to feed phase-tracker selectNextTasks so currentPhase is accurate.
 */
function closedTaskIdSet(closedBeads) {
  const s = new Set();
  if (Array.isArray(closedBeads)) {
    for (const b of closedBeads) {
      const tid = extractTaskId(b.title) || b.id;
      if (tid) s.add(tid);
    }
  }
  return s;
}

/**
 * Extract declared file claims from a bead record description/title.
 * Returns Array<string> of file paths.
 */
function extractFileClaims(bead) {
  if (!bead) return [];
  const text = [bead.title, bead.description || ''].join(' ');
  const claims = [];
  // "File: src/foo.ts" / "file: src/foo.ts"
  const filePrefixRe = /(?:file|target|path):\s*([^\s,]+)/gi;
  let m;
  while ((m = filePrefixRe.exec(text)) !== null) {
    if (m[1]) claims.push(m[1]);
  }
  // Common path patterns: src/*, lib/*, packages/*, etc.
  const pathRe = /\b(?:src|lib|packages|app|api|services|models|components|hooks|utils|tests?|spec|test)[^\s*\/]*(?:\/[^\s,;)]+)*/gi;
  while ((m = pathRe.exec(text)) !== null) {
    if (m[0] && !claims.includes(m[0])) claims.push(m[0]);
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Core selection
// ---------------------------------------------------------------------------

/**
 * Round-robin from each BV track, preserving track order and item order.
 * Continues rounds until all candidates are ordered.
 *
 * @param {Array<{track: number, items: Array<{id: string}>>} tracks
 * @returns {Array<{id: string, track: number, position: number}>}
 */
function roundRobinTracks(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  const iterators = tracks.map((t, ti) => ({
    track: ti,
    items: Array.isArray(t.items) ? t.items : [],
    pos: 0,
  }));

  const ordered = [];
  let madeProgress;

  do {
    madeProgress = false;
    for (const it of iterators) {
      if (it.pos < it.items.length) {
        const item = it.items[it.pos];
        if (item && item.id) {
          ordered.push({ id: item.id, track: it.track, position: it.pos });
          madeProgress = true;
        }
        it.pos++;
      }
    }
  } while (madeProgress);

  return ordered;
}

/**
 * Apply file-claim conflict avoidance.
 * Prefers candidates whose claims don't overlap already-selected ones.
 * Backfills from deferred when conflicts arise.
 *
 * @param {Array<{id, track, position}>} candidates
 * @param {Map<string, object>} beadMap
 * @param {number} slots
 * @returns {{selected: Array, deferred: Array}}
 */
function applyFileClaimFilter(candidates, beadMap, slots) {
  const selected = [];
  const deferred = [];
  const selectedClaims = new Set();
  let slotsUsed = 0;

  for (const candidate of candidates) {
    if (slotsUsed >= slots) {
      deferred.push({ ...candidate, deferReason: 'slot-cap-reached' });
      continue;
    }
    const bead = beadMap.get(candidate.id);
    const claims = new Set(extractFileClaims(bead));
    const hasConflict = [...claims].some((c) => selectedClaims.has(c));

    if (!hasConflict) {
      selected.push({ ...candidate, deferReason: null });
      for (const c of extractFileClaims(bead)) selectedClaims.add(c);
      slotsUsed++;
    } else {
      deferred.push({ ...candidate, deferReason: 'file-claim-conflict' });
    }
  }

  return { selected, deferred };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main planning function.
 *
 * @param {object|null} triageJson
 * @param {object|null} planJson  — bv --robot-plan output; null only when no ready work
 * @param {Array} readyBeads
 * @param {Array} openBeads
 * @param {Array} inProgressBeads
 * @param {Array} closedBeads     — NEW: scoped closed beads for phase resolution
 * @param {number} slots
 * @param {object} phaseTaskIds
 * @param {object} opts           — {prFormat: boolean}
 */
function planDispatch(
  triageJson,
  planJson,
  readyBeads,
  openBeads,
  inProgressBeads,
  closedBeads,
  slots,
  phaseTaskIds,
  opts
) {
  const options = opts || {};
  const prFormat = options.prFormat === true;
  const slots_ = Number.isFinite(slots) && slots >= 1 ? Math.floor(slots) : 1;

  // Step 1: Build eligible bead map (br-ready ∩ scoped open)
  const eligible = eligibleMap(readyBeads, openBeads);

  // Step 2: No eligible ready work → blocked
  if (eligible.size === 0) {
    return {
      selected: [],
      deferred: [],
      dispatchOrder: [],
      trackPositions: {},
      blocked:
        Array.isArray(openBeads) && openBeads.length > 0
          ? openBeads.map((b) => ({ id: b.id, reason: 'br-ready-empty' }))
          : [],
    };
  }

  // Step 3: Fail-closed validation — ready work exists, validate planJson
  if (!planJson || typeof planJson !== 'object') {
    throw new Error(
      'complete-beads-planner: planJson must be a non-null object when ready work exists'
    );
  }
  if (!Array.isArray(planJson.plan?.tracks)) {
    throw new Error(
      'complete-beads-planner: planJson.plan.tracks must be an Array'
    );
  }

  // Step 4: Round-robin across BV tracks
  const roundRobin = roundRobinTracks(planJson.plan.tracks);

  // Step 5: Fail-closed — BV returned zero track items → throw, no br-ready fallback
  if (roundRobin.length === 0) {
    throw new Error(
      'complete-beads-planner: bv --robot-plan returned no track items; failing closed'
    );
  }

  // Step 6: Fail-closed — BV plan must cover every eligible ready bead
  const bvProvidedIds = new Set(roundRobin.map((r) => r.id));
  const missingReadyIds = [...eligible.keys()].filter((id) => !bvProvidedIds.has(id));
  if (missingReadyIds.length > 0) {
    throw new Error(
      `complete-beads-planner: bv plan omits ${missingReadyIds.length} ready bead(s): ${missingReadyIds.join(', ')}`
    );
  }

  // Step 6.5: Filter to only eligible IDs.
  // roundRobin may contain out-of-scope items (blocked, closed, or non-tracked beads).
  // applyPhaseFilter and applyFileClaimFilter both use eligible.get(id) lookups that
  // return undefined for out-of-scope items, silently dispatching them with no claims.
  // By filtering here we make the eligibility guarantee explicit before any downstream
  // processing and also ensure closedTaskIdSet computation in applyPhaseFilter only
  // touches scoped beads.
  const scopedRoundRobin = roundRobin.filter((r) => eligible.has(r.id));

  // Step 7: Apply phase-strict filter if TRD phase metadata present
  const phaseFiltered = applyPhaseFilter(
    scopedRoundRobin,
    eligible,
    closedBeads,
    phaseTaskIds,
    prFormat
  );

  // Step 8: File-claim conflict avoidance + slot cap
  const { selected, deferred } = applyFileClaimFilter(phaseFiltered, eligible, slots_);

  return buildResult(selected, deferred);
}

/**
 * Apply phase-strict filtering via phase-tracker selectNextTasks.
 *
 * In prFormat mode: only ids belonging to the lowest-incomplete phase pass.
 * In non-strict mode: all ids pass through unchanged.
 *
 * @param {Array<{id, track, position}>} orderedIds — round-robin, already intersected with eligible
 * @param {Map<string, object>} eligibleMap
 * @param {Array} closedBeads — used to build closedTaskIdSet
 * @param {object} phaseTaskIds
 * @param {boolean} prFormat
 * @returns {Array} filtered in same order
 */
function applyPhaseFilter(orderedIds, eligibleMap, closedBeads, phaseTaskIds, prFormat) {
  if (!prFormat) return orderedIds;

  // Extract task IDs from all closed beads for accurate currentPhase detection
  const closedSet = closedTaskIdSet(closedBeads);
  const closedTaskIds = [...closedSet];

  // Build ordered ready task-id list (task-id suffix, not bead id)
  const readyTaskIds = orderedIds.map((r) => {
    const bead = eligibleMap.get(r.id);
    return extractTaskId(bead?.title) || r.id;
  });

  // selectNextTasks filters to only the lowest-incomplete phase.
  // Pass max=readyTaskIds.length so ALL same-phase candidates survive the filter —
  // applying the slot cap is applyFileClaimFilter's job, not selectNextTasks'.
  // Without this, selectNextTasks defaults max=1 and only one candidate reaches
  // applyFileClaimFilter even when slots=2, serializing what should be parallel work.
  const selectedTaskIds = selectNextTasks(
    readyTaskIds,
    phaseTaskIds,
    closedTaskIds,
    { prFormat: true, max: readyTaskIds.length }
  );
  const selectedSet = new Set(selectedTaskIds);

  return orderedIds.filter((r) => {
    const bead = eligibleMap.get(r.id);
    const taskId = extractTaskId(bead?.title) || r.id;
    return selectedSet.has(taskId);
  });
}

function buildResult(selected, deferred) {
  const dispatchOrder = selected.map((s) => s.id);
  const trackPositions = {};
  for (const s of selected) trackPositions[s.id] = { track: s.track, position: s.position };
  for (const d of deferred) trackPositions[d.id] = { track: d.track, position: d.position };

  return {
    selected: selected.map((s) => ({
      id: s.id,
      track: s.track,
      position: s.position,
      deferReason: s.deferReason,
    })),
    deferred: deferred.map((d) => ({
      id: d.id,
      track: d.track,
      position: d.position,
      deferReason: d.deferReason,
    })),
    dispatchOrder,
    trackPositions,
    blocked: [],
  };
}

module.exports = { planDispatch };
