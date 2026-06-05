'use strict';

/**
 * Phase-completion detection + phase-strict task selection.
 *
 * Extracts the phase-tracking logic from
 * packages/development/commands/implement-trd-beads.yaml into pure, tested
 * functions. NO side effects, NO shell, NO br/git/bv calls.
 *
 * ## The bug this replaces
 *
 * The original command prose selected the "next phase" by filtering beads
 * whose *title* contained a `phase:<N>` token. In stacked-PR mode the bead
 * titles did not reliably carry that token, so the filter matched ZERO beads
 * and the workflow either stalled or — worse — let a later-phase task whose
 * lone explicit dependency happened to be satisfied jump the queue, breaking
 * the stacked-PR ordering.
 *
 * The fix is to derive an authoritative task -> phase map from the parsed TRD
 * structure (`parsed.phases[].taskIds`) rather than from bead titles, and to
 * gate task selection on the *current* (lowest-incomplete) phase.
 *
 * @typedef {Object.<number, string[]>} PhaseTaskIds
 *   Map of phase number -> ordered list of task ids belonging to that phase.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a Set|array of closed task ids into a Set for O(1) membership.
 * @param {Set<string>|string[]|null|undefined} closedTaskIds
 * @returns {Set<string>}
 */
function toClosedSet(closedTaskIds) {
  if (closedTaskIds instanceof Set) return closedTaskIds;
  if (Array.isArray(closedTaskIds)) return new Set(closedTaskIds);
  return new Set();
}

/**
 * Build a reverse lookup: task id -> phase number, from a PhaseTaskIds map.
 * @param {PhaseTaskIds} phaseTaskIds
 * @returns {Map<string, number>}
 */
function buildTaskPhaseLookup(phaseTaskIds) {
  const lookup = new Map();
  const map = phaseTaskIds || {};
  for (const key of Object.keys(map)) {
    const phaseN = Number(key);
    const ids = Array.isArray(map[key]) ? map[key] : [];
    for (const id of ids) {
      // First-wins: a task id should only live in one phase; if duplicated,
      // keep its earliest-declared phase.
      if (!lookup.has(id)) lookup.set(id, phaseN);
    }
  }
  return lookup;
}

/**
 * Return phase numbers in ascending numeric order.
 * @param {PhaseTaskIds} phaseTaskIds
 * @returns {number[]}
 */
function sortedPhaseNumbers(phaseTaskIds) {
  const map = phaseTaskIds || {};
  return Object.keys(map)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the authoritative phase -> task-id map from a ParsedTRD.
 *
 * This is the map that REPLACES the broken `phase:<N>` title filter. Task ids
 * are taken in document order directly from `parsed.phases[].taskIds`.
 *
 * @param {{phases: Array<{n:number, taskIds:string[]}>}} parsed
 * @returns {PhaseTaskIds}
 */
function buildPhaseTaskIds(parsed) {
  const out = {};
  const phases = (parsed && Array.isArray(parsed.phases)) ? parsed.phases : [];
  for (const phase of phases) {
    if (!phase || !Number.isFinite(Number(phase.n))) continue;
    const n = Number(phase.n);
    const ids = Array.isArray(phase.taskIds) ? phase.taskIds.filter((id) => typeof id === 'string' && id) : [];
    out[n] = ids.slice();
  }
  return out;
}

/**
 * Lowest phase number that still has at least one non-closed task.
 *
 * @param {PhaseTaskIds} phaseTaskIds
 * @param {Set<string>|string[]} closedTaskIds
 * @returns {number|null} null when every task in every phase is closed
 *                        (or there are no tasks at all).
 */
function currentPhase(phaseTaskIds, closedTaskIds) {
  const closed = toClosedSet(closedTaskIds);
  const map = phaseTaskIds || {};
  for (const n of sortedPhaseNumbers(map)) {
    const ids = Array.isArray(map[n]) ? map[n] : [];
    const hasOpen = ids.some((id) => !closed.has(id));
    if (hasOpen) return n;
  }
  return null;
}

/**
 * True iff every task id in the given phase is closed.
 *
 * A phase with no tasks is considered complete (vacuously true).
 *
 * @param {PhaseTaskIds} phaseTaskIds
 * @param {number} phaseN
 * @param {Set<string>|string[]} closedTaskIds
 * @returns {boolean}
 */
function isPhaseComplete(phaseTaskIds, phaseN, closedTaskIds) {
  const closed = toClosedSet(closedTaskIds);
  const map = phaseTaskIds || {};
  const ids = Array.isArray(map[phaseN]) ? map[phaseN] : [];
  return ids.every((id) => closed.has(id));
}

/**
 * PHASE-STRICT next-task selection.
 *
 * `readyTaskIds` are the ids the scheduler (bv/br dependency view) reports as
 * unblocked. In PR/stacked mode we must NOT let a later-phase task jump ahead
 * just because its explicit dependency is satisfied — the phase boundary is an
 * additional, implicit gate. We therefore keep only ready ids whose task
 * belongs to the *current* (lowest-incomplete) phase.
 *
 * Edge — "ready id not in any phase": in strict (prFormat) mode an id that has
 * no phase mapping is DISCARDED. It cannot be proven to belong to the current
 * phase, and admitting it would risk re-introducing the boundary-jumping bug.
 * In non-strict mode such ids pass through unfiltered.
 *
 * @param {string[]} readyTaskIds  scheduler-unblocked ids, in priority order
 * @param {PhaseTaskIds} phaseTaskIds
 * @param {Set<string>|string[]} closedTaskIds
 * @param {{prFormat?: boolean, max?: number}} [opts]
 * @returns {string[]} up to opts.max ids, preserving readyTaskIds order
 */
function selectNextTasks(readyTaskIds, phaseTaskIds, closedTaskIds, opts) {
  const ready = Array.isArray(readyTaskIds) ? readyTaskIds : [];
  const options = opts || {};
  const prFormat = options.prFormat === true;
  const max = Number.isFinite(options.max) && options.max > 0 ? Math.floor(options.max) : 1;

  let eligible;
  if (!prFormat) {
    eligible = ready.slice();
  } else {
    const cp = currentPhase(phaseTaskIds, closedTaskIds);
    if (cp === null) {
      // Everything is closed — nothing to select.
      eligible = [];
    } else {
      const lookup = buildTaskPhaseLookup(phaseTaskIds);
      // Keep only ready ids known to belong to the current phase. Unknown ids
      // (not in any phase) are discarded in strict mode — see doc above.
      eligible = ready.filter((id) => lookup.get(id) === cp);
    }
  }

  return eligible.slice(0, max);
}

/**
 * RESUME counterpart to {@link buildPhaseTaskIds}.
 *
 * On a cross-session resume the TRD parse may not be in memory. The command
 * recovers, for each phase's story bead, the ids of its dependency-children
 * (via `br`) as a `{ [phaseN]: string[] }` map. This function validates and
 * normalizes that recovered shape so the rest of the phase-tracking logic can
 * consume it identically to `buildPhaseTaskIds` output.
 *
 * Normalization rules:
 *   - keys are coerced to finite numbers (non-numeric keys dropped)
 *   - values must be arrays of non-empty strings (non-strings dropped)
 *   - phases whose id list is empty after filtering are dropped
 *
 * @param {Object.<number, string[]>} storyChildren
 * @returns {PhaseTaskIds}
 */
function reconstructPhaseTaskIds(storyChildren) {
  const out = {};
  const src = (storyChildren && typeof storyChildren === 'object') ? storyChildren : {};
  for (const key of Object.keys(src)) {
    const n = Number(key);
    if (!Number.isFinite(n)) continue;
    const raw = Array.isArray(src[key]) ? src[key] : [];
    const ids = raw.filter((id) => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) continue;
    out[n] = ids.slice();
  }
  return out;
}

module.exports = {
  buildPhaseTaskIds,
  currentPhase,
  isPhaseComplete,
  selectNextTasks,
  reconstructPhaseTaskIds,
};
