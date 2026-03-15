/**
 * TRD-032: Parallel builder execution tests
 *
 * Validates the parallel builder dispatch specification from
 * packages/development/commands/implement-trd-beads.yaml sections
 * TRD-025 (Parallel Builder Execution), TRD-026 (Sequential Commit Ordering),
 * and TRD-027 (Parallel Builder Failure Isolation).
 *
 * Bead: ensemble-bxv
 */

'use strict';

// ---------------------------------------------------------------------------
// TRD-025-3: File conflict detection
// ---------------------------------------------------------------------------

/**
 * Given a list of candidate tasks (each with a files array), returns an
 * ordered CONFLICT_FREE list where no file path appears more than once.
 * First occurrence of a file wins; later tasks claiming the same file are
 * discarded. The result is also capped at maxSlots entries.
 *
 * @param {Array<{ id: string, files: string[] }>} candidates
 * @param {number} [maxSlots=Infinity]
 * @returns {Array<{ id: string, files: string[] }>}
 */
function selectConflictFree(candidates, maxSlots = Infinity) {
  const seenFiles = new Set();
  const conflictFree = [];

  for (const task of candidates) {
    if (conflictFree.length >= maxSlots) break;

    const hasOverlap = task.files.some(f => seenFiles.has(f));
    if (!hasOverlap) {
      conflictFree.push(task);
      for (const f of task.files) seenFiles.add(f);
    }
  }

  return conflictFree;
}

// ---------------------------------------------------------------------------
// TRD-025-4: Parallel dispatch plan
// ---------------------------------------------------------------------------

/**
 * Given the CONFLICT_FREE task list, builds a dispatch plan describing the
 * three phases of parallel builder execution:
 *   - preflightTasks: per-task pre-flight items (sequential, in CONFLICT_FREE order)
 *   - concurrentTasks: all Task() calls issued simultaneously
 *   - bookkeepingTasks: per-task post-dispatch bookkeeping (sequential, in CONFLICT_FREE order)
 *
 * @param {Array<{ id: string, files: string[] }>} conflictFree
 * @returns {{ preflightTasks: string[], concurrentTasks: string[], bookkeepingTasks: string[] }}
 */
function buildDispatchPlan(conflictFree) {
  const preflightTasks = conflictFree.map(t => `preflight:${t.id}`);
  const concurrentTasks = conflictFree.map(t => `Task(${t.id})`);
  const bookkeepingTasks = conflictFree.map(t => `bookkeeping:${t.id}`);
  return { preflightTasks, concurrentTasks, bookkeepingTasks };
}

// ---------------------------------------------------------------------------
// TRD-026: Sequential commit ordering
// ---------------------------------------------------------------------------

/**
 * Processes the commit queue one task at a time.  hasConflict is a predicate
 * that receives a task id and returns 'none' | 'retry-ok' | 'retry-fail'.
 *
 * IMPORTANT: The hasConflict predicate is expected to have already attempted
 * exactly one retry before returning its result. 'retry-ok' means the single
 * retry resolved the conflict; 'retry-fail' means the conflict persisted after
 * that one retry. The single-retry constraint is enforced by the predicate's
 * caller, not by this queue processor.
 *
 * Returns an array of result objects:
 *   { id, commitOrder, status, comment }
 *
 * @param {Array<{ id: string, beadId: string }>} queue
 * @param {function(string): 'none'|'retry-ok'|'retry-fail'} hasConflict
 * @returns {Array<{ id: string, commitOrder: number, status: string, comment: string }>}
 */
function processCommitQueue(queue, hasConflict) {
  const results = [];

  for (let i = 0; i < queue.length; i++) {
    const task = queue[i];
    const N = i + 1; // 1-indexed commit order
    const conflict = hasConflict(task.id);

    if (conflict === 'none') {
      results.push({
        id: task.id,
        commitOrder: N,
        status: 'committed',
        comment: `commit-order:${N} commit:sha-${task.id}`,
      });
    } else if (conflict === 'retry-ok') {
      results.push({
        id: task.id,
        commitOrder: N,
        status: 'committed',
        comment: `commit-order:${N} commit:sha-${task.id}`,
      });
    } else {
      // retry-fail: return to open
      results.push({
        id: task.id,
        commitOrder: N,
        status: 'open',
        comment: `status:open commit-conflict-unresolved: returned to open`,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// TRD-027: Builder failure isolation
// ---------------------------------------------------------------------------

/**
 * Handles a single builder failure:
 *   - Resets the task status back to 'open'
 *   - Produces a pure audit comment (NO status: prefix)
 *
 * @param {string} beadId
 * @param {string} agentType
 * @param {string} error
 * @returns {{ resetStatus: string, comment: string }}
 */
function handleBuilderFailure(beadId, agentType, error) {
  return {
    resetStatus: 'open',
    comment: `verdict:failed builder:${agentType} reason:${error}`,
  };
}

// ---------------------------------------------------------------------------
// TRD-025-5/027-5: Builder slot management
// ---------------------------------------------------------------------------

/**
 * Manages active builder slot count, ensuring it never exceeds maxSlots.
 * Both completed and failed tasks free their slot immediately.
 *
 * @param {number} slots        - Current number of active builder slots in use
 * @param {number} maxSlots     - Maximum allowed concurrent builders
 * @param {number} completed    - Number of tasks that completed successfully this tick
 * @param {number} failed       - Number of tasks that failed this tick
 * @returns {number}            - Available (free) slot count
 */
function manageBuilderSlots(slots, maxSlots, completed, failed) {
  const active = Math.max(0, slots - completed - failed);
  return Math.max(0, maxSlots - active);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Parallel Builders - File Conflict Detection (TRD-025-3)', () => {
  test('two tasks with no overlapping files - both included in result', () => {
    const candidates = [
      { id: 'TRD-001', files: ['src/api.ts', 'src/types.ts'] },
      { id: 'TRD-002', files: ['src/service.ts', 'src/db.ts'] },
    ];
    const result = selectConflictFree(candidates);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('TRD-001');
    expect(result[1].id).toBe('TRD-002');
  });

  test('two tasks sharing a file - only the first is included', () => {
    const candidates = [
      { id: 'TRD-001', files: ['src/api.ts', 'src/types.ts'] },
      { id: 'TRD-002', files: ['src/api.ts', 'src/db.ts'] },
    ];
    const result = selectConflictFree(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TRD-001');
  });

  test('three tasks: task2 overlaps task1, task3 does not - result is [task1, task3]', () => {
    const candidates = [
      { id: 'TRD-001', files: ['src/api.ts'] },
      { id: 'TRD-002', files: ['src/api.ts'] },    // conflicts with task1
      { id: 'TRD-003', files: ['src/service.ts'] }, // no conflict
    ];
    const result = selectConflictFree(candidates);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('TRD-001');
    expect(result[1].id).toBe('TRD-003');
  });

  test('empty candidate list returns empty result', () => {
    const result = selectConflictFree([]);
    expect(result).toHaveLength(0);
  });

  test('BUILDER_SLOTS=1 limits result to 1 even when no file conflicts exist', () => {
    const candidates = [
      { id: 'TRD-001', files: ['src/a.ts'] },
      { id: 'TRD-002', files: ['src/b.ts'] },
      { id: 'TRD-003', files: ['src/c.ts'] },
    ];
    const result = selectConflictFree(candidates, 1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TRD-001');
  });
});

// ---------------------------------------------------------------------------

describe('Parallel Builders - Dispatch Plan Structure (TRD-025-4)', () => {
  test('N tasks produce N entries in each phase list', () => {
    const conflictFree = [
      { id: 'TRD-001', files: ['src/a.ts'] },
      { id: 'TRD-002', files: ['src/b.ts'] },
      { id: 'TRD-003', files: ['src/c.ts'] },
    ];
    const plan = buildDispatchPlan(conflictFree);
    expect(plan.preflightTasks).toHaveLength(3);
    expect(plan.concurrentTasks).toHaveLength(3);
    expect(plan.bookkeepingTasks).toHaveLength(3);
  });

  test('preflight order matches CONFLICT_FREE order', () => {
    const conflictFree = [
      { id: 'TRD-001', files: ['src/a.ts'] },
      { id: 'TRD-002', files: ['src/b.ts'] },
    ];
    const plan = buildDispatchPlan(conflictFree);
    expect(plan.preflightTasks[0]).toContain('TRD-001');
    expect(plan.preflightTasks[1]).toContain('TRD-002');
  });

  test('concurrent batch contains all tasks from CONFLICT_FREE', () => {
    const conflictFree = [
      { id: 'TRD-001', files: ['src/a.ts'] },
      { id: 'TRD-002', files: ['src/b.ts'] },
    ];
    const plan = buildDispatchPlan(conflictFree);
    expect(plan.concurrentTasks.some(t => t.includes('TRD-001'))).toBe(true);
    expect(plan.concurrentTasks.some(t => t.includes('TRD-002'))).toBe(true);
  });

  test('single task produces single entry in each phase list', () => {
    const conflictFree = [{ id: 'TRD-001', files: ['src/a.ts'] }];
    const plan = buildDispatchPlan(conflictFree);
    expect(plan.preflightTasks).toHaveLength(1);
    expect(plan.concurrentTasks).toHaveLength(1);
    expect(plan.bookkeepingTasks).toHaveLength(1);
  });

  test('empty CONFLICT_FREE produces empty phase lists', () => {
    const plan = buildDispatchPlan([]);
    expect(plan.preflightTasks).toHaveLength(0);
    expect(plan.concurrentTasks).toHaveLength(0);
    expect(plan.bookkeepingTasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('Parallel Builders - Sequential Commit Ordering (TRD-026)', () => {
  test('two tasks with no conflicts - both committed with commit-order 1 and 2', () => {
    const queue = [
      { id: 'TRD-001', beadId: 'bead-001' },
      { id: 'TRD-002', beadId: 'bead-002' },
    ];
    const results = processCommitQueue(queue, () => 'none');
    expect(results[0].status).toBe('committed');
    expect(results[0].commitOrder).toBe(1);
    expect(results[1].status).toBe('committed');
    expect(results[1].commitOrder).toBe(2);
  });

  test('task2 has conflict but retry succeeds - committed as commit-order 2', () => {
    const queue = [
      { id: 'TRD-001', beadId: 'bead-001' },
      { id: 'TRD-002', beadId: 'bead-002' },
    ];
    const results = processCommitQueue(queue, id =>
      id === 'TRD-002' ? 'retry-ok' : 'none'
    );
    expect(results[1].status).toBe('committed');
    expect(results[1].commitOrder).toBe(2);
  });

  test('task2 conflict and retry fails - returned to open with unresolved comment', () => {
    const queue = [
      { id: 'TRD-001', beadId: 'bead-001' },
      { id: 'TRD-002', beadId: 'bead-002' },
    ];
    const results = processCommitQueue(queue, id =>
      id === 'TRD-002' ? 'retry-fail' : 'none'
    );
    expect(results[1].status).toBe('open');
    expect(results[1].comment).toContain('commit-conflict-unresolved');
    expect(results[1].comment).toContain('status:open');
  });

  test('commit-order is 1-indexed position in queue', () => {
    const queue = [
      { id: 'TRD-001', beadId: 'bead-001' },
      { id: 'TRD-002', beadId: 'bead-002' },
      { id: 'TRD-003', beadId: 'bead-003' },
    ];
    const results = processCommitQueue(queue, () => 'none');
    expect(results[0].commitOrder).toBe(1);
    expect(results[1].commitOrder).toBe(2);
    expect(results[2].commitOrder).toBe(3);
  });

  test('commit comment for successful commit includes commit-order and commit sha', () => {
    const queue = [{ id: 'TRD-001', beadId: 'bead-001' }];
    const results = processCommitQueue(queue, () => 'none');
    expect(results[0].comment).toContain('commit-order:1');
    expect(results[0].comment).toContain('commit:');
  });
});

// ---------------------------------------------------------------------------

describe('Parallel Builders - Failure Isolation (TRD-027)', () => {
  test('handleBuilderFailure resets task status to open', () => {
    const result = handleBuilderFailure('bead-001', 'backend-developer', 'compilation-error');
    expect(result.resetStatus).toBe('open');
  });

  test('failure comment has NO status: prefix (pure audit record)', () => {
    const result = handleBuilderFailure('bead-001', 'backend-developer', 'compilation-error');
    expect(result.comment.startsWith('status:')).toBe(false);
  });

  test('failure comment contains verdict:failed', () => {
    const result = handleBuilderFailure('bead-001', 'backend-developer', 'compilation-error');
    expect(result.comment).toContain('verdict:failed');
  });

  test('failure comment contains the builder agent type', () => {
    const result = handleBuilderFailure('bead-001', 'frontend-developer', 'type-error');
    expect(result.comment).toContain('builder:frontend-developer');
  });

  test('failure comment contains the error reason', () => {
    const result = handleBuilderFailure('bead-001', 'backend-developer', 'missing-dependency');
    expect(result.comment).toContain('reason:missing-dependency');
  });

  test('other builder results are not affected by one failure', () => {
    // Simulate a shared result registry where two builders completed
    const sharedResults = new Map([
      ['bead-001', { status: 'committed', commitOrder: 1 }],
      ['bead-002', { status: 'committed', commitOrder: 2 }],
    ]);

    // Simulate applying a failure only to bead-001
    const failure = handleBuilderFailure('bead-001', 'backend-developer', 'runtime-error');
    sharedResults.set('bead-001', { ...sharedResults.get('bead-001'), status: failure.resetStatus });

    // bead-002 must be completely unaffected
    expect(sharedResults.get('bead-002').status).toBe('committed');
    expect(sharedResults.get('bead-002').commitOrder).toBe(2);

    // bead-001 is correctly reset
    expect(sharedResults.get('bead-001').status).toBe('open');
  });
});

// ---------------------------------------------------------------------------

describe('Parallel Builders - Slot Management (TRD-025-5 / TRD-027-5)', () => {
  test('completing a task frees a slot', () => {
    // 2 slots in use out of 3 max, 1 completes -> 2 slots available
    const available = manageBuilderSlots(2, 3, 1, 0);
    expect(available).toBe(2);
  });

  test('failing a task frees a slot immediately', () => {
    // 2 slots in use out of 3 max, 1 fails -> 2 slots available
    const available = manageBuilderSlots(2, 3, 0, 1);
    expect(available).toBe(2);
  });

  test('slots never exceed maxSlots', () => {
    // 0 slots in use out of 2 max, 0 complete, 0 fail -> 2 available (capped at maxSlots)
    const available = manageBuilderSlots(0, 2, 0, 0);
    expect(available).toBe(2);
  });

  test('all slots in use, none freed - zero slots available', () => {
    const available = manageBuilderSlots(3, 3, 0, 0);
    expect(available).toBe(0);
  });

  test('both completions and failures free slots in the same tick', () => {
    // 3 slots in use out of 3 max, 1 completes and 1 fails -> 2 freed -> 2 available
    const available = manageBuilderSlots(3, 3, 1, 1);
    expect(available).toBe(2);
  });
});
