/**
 * TRD-044: Unit tests for team metrics accumulation, summary, and persistence
 *
 * Covers:
 *   TRD-034 — In-memory metrics accumulator (accumulateTaskMetrics)
 *   TRD-035 — Phase performance summary (computeBuilderRate, formatPhaseSummary, formatEpicComment)
 *   TRD-036 — BUILDERS_JSON schema (buildMetricsJSON)
 *   TRD-044 AC-TM-4 — Cross-session resume via parseMetricsFromComment
 *
 * Bead: ensemble-trd044
 */

'use strict';

// ---------------------------------------------------------------------------
// TEAM_METRICS structure (TRD-034 initialization spec)
// ---------------------------------------------------------------------------

/**
 * Creates a fresh TEAM_METRICS accumulator for a given phase.
 *
 * @param {number} phase - The current phase number
 * @returns {Object} Initialized TEAM_METRICS object
 */
function createTeamMetrics(phase) {
  return {
    phase,
    tasks_completed: 0,
    builders: {},
    task_details: [],
  };
}

// ---------------------------------------------------------------------------
// accumulateTaskMetrics — TRD-034 step 5
// ---------------------------------------------------------------------------

/**
 * Updates TEAM_METRICS in place after a single task closure.
 *
 * @param {Object} metrics - The in-memory TEAM_METRICS accumulator (mutated in place)
 * @param {Object} taskResult - Result descriptor for the closed task
 * @param {string} taskResult.builder_agent - The agent that implemented the task
 * @param {number} taskResult.rejection_cycles - How many verdict:rejected lines were counted
 * @param {string} taskResult.bead_id - Bead identifier
 * @param {string} taskResult.task_id - TRD-XXX identifier
 * @returns {void}
 */
function accumulateTaskMetrics(metrics, taskResult) {
  const { builder_agent, rejection_cycles, bead_id, task_id } = taskResult;

  const first_pass_approval = rejection_cycles === 0;

  // Update top-level counter
  metrics.tasks_completed += 1;

  // Initialize per-builder entry if absent
  if (!metrics.builders[builder_agent]) {
    metrics.builders[builder_agent] = {
      tasks: 0,
      first_pass_approvals: 0,
      rejections: 0,
    };
  }

  const builderEntry = metrics.builders[builder_agent];
  builderEntry.tasks += 1;
  if (first_pass_approval) {
    builderEntry.first_pass_approvals += 1;
  }
  builderEntry.rejections += rejection_cycles;

  // Append task detail entry
  metrics.task_details.push({
    id: bead_id,
    task_id,
    builder: builder_agent,
    rejection_cycles,
    first_pass_approval,
  });
}

// ---------------------------------------------------------------------------
// computeBuilderRate — TRD-035 per-builder first_pass_rate
// ---------------------------------------------------------------------------

/**
 * Computes the first-pass approval rate for a single builder entry.
 *
 * @param {{ tasks: number, first_pass_approvals: number }} builder - Builder stats entry
 * @returns {number} First-pass rate as a float 0.0–100.0
 */
function computeBuilderRate(builder) {
  if (!builder || builder.tasks === 0) return 0.0;
  return (builder.first_pass_approvals / builder.tasks) * 100;
}

// ---------------------------------------------------------------------------
// formatPhaseSummary — TRD-035 step 2 console output
// ---------------------------------------------------------------------------

/**
 * Returns the console-output block for the team performance summary.
 *
 * @param {Object} metrics - TEAM_METRICS accumulator
 * @returns {string} Multi-line formatted summary string
 */
function formatPhaseSummary(metrics) {
  const total_rejections = metrics.task_details.reduce(
    (sum, t) => sum + t.rejection_cycles,
    0
  );

  const first_pass_approvals_count = metrics.task_details.filter(
    t => t.first_pass_approval
  ).length;

  const first_pass_rate =
    metrics.tasks_completed > 0
      ? (first_pass_approvals_count / metrics.tasks_completed) * 100
      : 0.0;

  const avg_rejection_cycles =
    metrics.tasks_completed > 0
      ? (total_rejections / metrics.tasks_completed).toFixed(2)
      : '0.00';

  const lines = [
    `=== TEAM PERFORMANCE SUMMARY — Phase ${metrics.phase} ===`,
    `Tasks completed: ${metrics.tasks_completed}`,
    `First-pass approval rate: ${first_pass_rate}%`,
    `Total rejection cycles: ${total_rejections}`,
    `Average rejection cycles: ${avg_rejection_cycles} per task`,
    'Per-builder breakdown:',
  ];

  for (const [agentName, entry] of Object.entries(metrics.builders)) {
    lines.push(
      `  ${agentName}: tasks=${entry.tasks} first-pass=${entry.first_pass_approvals} rejections=${entry.rejections}`
    );
  }

  lines.push('=== END TEAM SUMMARY ===');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// buildMetricsJSON — TRD-036 BUILDERS_JSON schema
// ---------------------------------------------------------------------------

/**
 * Builds the BUILDERS_JSON object matching the TRD-036 schema.
 *
 * @param {Object} metrics - TEAM_METRICS accumulator
 * @returns {Object} JSON-serialisable metrics object
 */
function buildMetricsJSON(metrics) {
  const total_rejections = metrics.task_details.reduce(
    (sum, t) => sum + t.rejection_cycles,
    0
  );

  const first_pass_approvals_count = metrics.task_details.filter(
    t => t.first_pass_approval
  ).length;

  const first_pass_rate =
    metrics.tasks_completed > 0
      ? (first_pass_approvals_count / metrics.tasks_completed) * 100
      : 0.0;

  const avg_rejection_cycles =
    metrics.tasks_completed > 0
      ? total_rejections / metrics.tasks_completed
      : 0.0;

  const builders = {};
  for (const [agentName, entry] of Object.entries(metrics.builders)) {
    builders[agentName] = {
      tasks: entry.tasks,
      first_pass_approvals: entry.first_pass_approvals,
      rejections: entry.rejections,
      // total_review_cycles is an alias for rejections — both represent the
      // cumulative count of review cycles that did not pass on first attempt.
      total_review_cycles: entry.rejections,
      first_pass_rate: computeBuilderRate(entry),
    };
  }

  return {
    phase: metrics.phase,
    tasks_completed: metrics.tasks_completed,
    first_pass_rate,
    total_rejections,
    avg_rejection_cycles,
    builders,
  };
}

// ---------------------------------------------------------------------------
// formatEpicComment — TRD-035 step 3 br comment string
// ---------------------------------------------------------------------------

/**
 * Formats the br comment string to be added to ROOT_EPIC_ID.
 *
 * Format: team-metrics:phase-<N> tasks:<T> first-pass-rate:<R>% total-rejections:<X> builders:<JSON>
 *
 * @param {Object} metrics - TEAM_METRICS accumulator
 * @returns {string} The full br comment value
 */
function formatEpicComment(metrics) {
  const json = buildMetricsJSON(metrics);
  const buildersJson = JSON.stringify(json);
  return (
    `team-metrics:phase-${metrics.phase}` +
    ` tasks:${json.tasks_completed}` +
    ` first-pass-rate:${json.first_pass_rate}%` +
    ` total-rejections:${json.total_rejections}` +
    ` builders:${buildersJson}`
  );
}

// ---------------------------------------------------------------------------
// parseMetricsFromComment — TRD-044 AC-TM-4 cross-session resume
// ---------------------------------------------------------------------------

/**
 * Parses a br comment produced by formatEpicComment back into a metrics object.
 *
 * Returns null if the comment does not start with 'team-metrics:phase-'.
 * Returns a partial object (with null builders) if the builders: field is absent or malformed.
 *
 * @param {string} comment - The raw br comment string
 * @returns {Object|null} Parsed metrics or null on format mismatch
 */
function parseMetricsFromComment(comment) {
  if (!comment || typeof comment !== 'string') return null;
  if (!comment.startsWith('team-metrics:phase-')) return null;

  // Extract phase
  const phaseMatch = comment.match(/^team-metrics:phase-(\d+)/);
  if (!phaseMatch) return null;
  const phase = parseInt(phaseMatch[1], 10);

  // Extract scalar tokens (before builders: JSON which may contain spaces)
  const tasksMatch = comment.match(/\btasks:(\d+)/);
  const fprMatch = comment.match(/\bfirst-pass-rate:([\d.]+)%/);
  const rejMatch = comment.match(/\btotal-rejections:(\d+)/);

  const tasks_completed = tasksMatch ? parseInt(tasksMatch[1], 10) : 0;
  const first_pass_rate = fprMatch ? parseFloat(fprMatch[1]) : 0.0;
  const total_rejections = rejMatch ? parseInt(rejMatch[1], 10) : 0;

  // Extract builders: JSON — everything after 'builders:'
  const buildersIdx = comment.indexOf(' builders:');
  let builders = null;
  let avg_rejection_cycles = 0.0;
  if (buildersIdx !== -1) {
    const buildersRaw = comment.substring(buildersIdx + ' builders:'.length);
    try {
      const parsed = JSON.parse(buildersRaw);
      builders = parsed.builders || null;
      avg_rejection_cycles =
        typeof parsed.avg_rejection_cycles === 'number'
          ? parsed.avg_rejection_cycles
          : 0.0;
    } catch (_) {
      builders = null;
    }
  }

  return {
    phase,
    tasks_completed,
    first_pass_rate,
    total_rejections,
    avg_rejection_cycles,
    builders,
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a populated TEAM_METRICS object from a list of task descriptors.
 *
 * @param {number} phase
 * @param {Array<{builder_agent: string, rejection_cycles: number}>} tasks
 * @returns {Object}
 */
function buildMetricsFromTasks(phase, tasks) {
  const metrics = createTeamMetrics(phase);
  tasks.forEach((t, i) =>
    accumulateTaskMetrics(metrics, {
      builder_agent: t.builder_agent,
      rejection_cycles: t.rejection_cycles,
      bead_id: `bead-${i + 1}`,
      task_id: `TRD-${String(i + 1).padStart(3, '0')}`,
    })
  );
  return metrics;
}

// ===========================================================================
// Tests: Metrics Accumulation Accuracy (TRD-034)
// ===========================================================================

describe('TRD-034: accumulateTaskMetrics', () => {
  test('1 rejection then 1 approval -> rejection_cycles=1, first_pass_approval=false', () => {
    const metrics = createTeamMetrics(1);
    accumulateTaskMetrics(metrics, {
      builder_agent: 'backend-developer',
      rejection_cycles: 1,
      bead_id: 'bead-1',
      task_id: 'TRD-001',
    });
    expect(metrics.task_details[0].rejection_cycles).toBe(1);
    expect(metrics.task_details[0].first_pass_approval).toBe(false);
  });

  test('0 rejections, approval -> rejection_cycles=0, first_pass_approval=true', () => {
    const metrics = createTeamMetrics(1);
    accumulateTaskMetrics(metrics, {
      builder_agent: 'backend-developer',
      rejection_cycles: 0,
      bead_id: 'bead-1',
      task_id: 'TRD-001',
    });
    expect(metrics.task_details[0].rejection_cycles).toBe(0);
    expect(metrics.task_details[0].first_pass_approval).toBe(true);
  });

  test('2 rejections then approval -> rejection_cycles=2, first_pass_approval=false', () => {
    const metrics = createTeamMetrics(1);
    accumulateTaskMetrics(metrics, {
      builder_agent: 'backend-developer',
      rejection_cycles: 2,
      bead_id: 'bead-1',
      task_id: 'TRD-001',
    });
    expect(metrics.task_details[0].rejection_cycles).toBe(2);
    expect(metrics.task_details[0].first_pass_approval).toBe(false);
  });

  test('per-builder tasks count increments for each completion', () => {
    const metrics = createTeamMetrics(1);
    accumulateTaskMetrics(metrics, { builder_agent: 'backend-developer', rejection_cycles: 0, bead_id: 'b1', task_id: 'TRD-001' });
    accumulateTaskMetrics(metrics, { builder_agent: 'backend-developer', rejection_cycles: 0, bead_id: 'b2', task_id: 'TRD-002' });
    accumulateTaskMetrics(metrics, { builder_agent: 'backend-developer', rejection_cycles: 1, bead_id: 'b3', task_id: 'TRD-003' });
    expect(metrics.builders['backend-developer'].tasks).toBe(3);
  });

  test('per-builder first_pass_approvals increments only on first_pass_approval=true', () => {
    const metrics = createTeamMetrics(1);
    accumulateTaskMetrics(metrics, { builder_agent: 'backend-developer', rejection_cycles: 0, bead_id: 'b1', task_id: 'TRD-001' });
    accumulateTaskMetrics(metrics, { builder_agent: 'backend-developer', rejection_cycles: 1, bead_id: 'b2', task_id: 'TRD-002' });
    accumulateTaskMetrics(metrics, { builder_agent: 'backend-developer', rejection_cycles: 0, bead_id: 'b3', task_id: 'TRD-003' });
    expect(metrics.builders['backend-developer'].first_pass_approvals).toBe(2);
  });

  test('tasks_completed increments each time regardless of builder or rejections', () => {
    const metrics = createTeamMetrics(2);
    accumulateTaskMetrics(metrics, { builder_agent: 'backend-developer',  rejection_cycles: 0, bead_id: 'b1', task_id: 'TRD-001' });
    accumulateTaskMetrics(metrics, { builder_agent: 'frontend-developer', rejection_cycles: 2, bead_id: 'b2', task_id: 'TRD-002' });
    accumulateTaskMetrics(metrics, { builder_agent: 'backend-developer',  rejection_cycles: 1, bead_id: 'b3', task_id: 'TRD-003' });
    expect(metrics.tasks_completed).toBe(3);
  });

  test('two distinct builders each get their own entry in metrics.builders', () => {
    const metrics = createTeamMetrics(1);
    accumulateTaskMetrics(metrics, { builder_agent: 'backend-developer',  rejection_cycles: 0, bead_id: 'b1', task_id: 'TRD-001' });
    accumulateTaskMetrics(metrics, { builder_agent: 'frontend-developer', rejection_cycles: 1, bead_id: 'b2', task_id: 'TRD-002' });
    expect(Object.keys(metrics.builders)).toHaveLength(2);
    expect(metrics.builders['backend-developer']).toBeDefined();
    expect(metrics.builders['frontend-developer']).toBeDefined();
  });
});

// ===========================================================================
// Tests: Per-builder pass rate (TRD-035)
// ===========================================================================

describe('TRD-035: computeBuilderRate', () => {
  test('3 tasks, 3 first-pass -> 100.0%', () => {
    expect(computeBuilderRate({ tasks: 3, first_pass_approvals: 3 })).toBe(100.0);
  });

  test('3 tasks, 0 first-pass -> 0.0%', () => {
    expect(computeBuilderRate({ tasks: 3, first_pass_approvals: 0 })).toBe(0.0);
  });

  test('4 tasks, 2 first-pass -> 50.0%', () => {
    expect(computeBuilderRate({ tasks: 4, first_pass_approvals: 2 })).toBe(50.0);
  });

  test('0 tasks -> 0.0% (no division by zero)', () => {
    expect(computeBuilderRate({ tasks: 0, first_pass_approvals: 0 })).toBe(0.0);
  });

  test('null builder entry -> 0.0%', () => {
    expect(computeBuilderRate(null)).toBe(0.0);
  });
});

// ===========================================================================
// Tests: Phase summary output format (TRD-035 step 2)
// ===========================================================================

describe('TRD-035: formatPhaseSummary', () => {
  let metrics;

  beforeEach(() => {
    metrics = buildMetricsFromTasks(1, [
      { builder_agent: 'backend-developer',  rejection_cycles: 0 },
      { builder_agent: 'frontend-developer', rejection_cycles: 1 },
      { builder_agent: 'backend-developer',  rejection_cycles: 0 },
    ]);
  });

  test('contains TEAM PERFORMANCE SUMMARY header', () => {
    const summary = formatPhaseSummary(metrics);
    expect(summary).toContain('TEAM PERFORMANCE SUMMARY');
  });

  test('contains tasks_completed count', () => {
    const summary = formatPhaseSummary(metrics);
    expect(summary).toContain('Tasks completed: 3');
  });

  test('contains first_pass_rate percentage', () => {
    // 2 first-pass out of 3 tasks = 66.666...%
    const summary = formatPhaseSummary(metrics);
    expect(summary).toContain('First-pass approval rate:');
    expect(summary).toContain('%');
  });

  test('contains total_rejections count', () => {
    const summary = formatPhaseSummary(metrics);
    expect(summary).toContain('Total rejection cycles: 1');
  });

  test('contains each builder name in per-builder breakdown', () => {
    const summary = formatPhaseSummary(metrics);
    expect(summary).toContain('backend-developer');
    expect(summary).toContain('frontend-developer');
  });

  test('contains END TEAM SUMMARY marker', () => {
    const summary = formatPhaseSummary(metrics);
    expect(summary).toContain('END TEAM SUMMARY');
  });

  test('contains average rejection cycles', () => {
    const summary = formatPhaseSummary(metrics);
    expect(summary).toContain('Average rejection cycles:');
    expect(summary).toContain('per task');
  });

  test('zero-rejection run shows 100% first-pass rate', () => {
    const allPass = buildMetricsFromTasks(2, [
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
    ]);
    const summary = formatPhaseSummary(allPass);
    expect(summary).toContain('First-pass approval rate: 100%');
    expect(summary).toContain('Total rejection cycles: 0');
  });
});

// ===========================================================================
// Tests: BUILDERS_JSON format (TRD-036)
// ===========================================================================

describe('TRD-036: buildMetricsJSON', () => {
  // Note: avg_time_per_state and total_time are intentionally omitted here.
  // Those fields require per-task timing instrumentation (time_in_progress,
  // time_in_review, time_in_qa) which accumulateTaskMetrics does not collect —
  // it only receives rejection_cycles counts, not wall-clock durations.
  test('has all computable required top-level fields (timing fields not collected)', () => {
    const metrics = buildMetricsFromTasks(1, [
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
    ]);
    const json = buildMetricsJSON(metrics);
    expect(json).toHaveProperty('phase');
    expect(json).toHaveProperty('tasks_completed');
    expect(json).toHaveProperty('first_pass_rate');
    expect(json).toHaveProperty('total_rejections');
    expect(json).toHaveProperty('avg_rejection_cycles');
    expect(json).toHaveProperty('builders');
  });

  test('avg_rejection_cycles = total_rejections / tasks_completed (float)', () => {
    const metrics = buildMetricsFromTasks(1, [
      { builder_agent: 'backend-developer', rejection_cycles: 2 },
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
    ]);
    const json = buildMetricsJSON(metrics);
    // total_rejections=2, tasks_completed=2 -> avg=1.0
    expect(json.avg_rejection_cycles).toBe(1.0);
  });

  test('avg_rejection_cycles = 0.0 when tasks_completed = 0 (division-by-zero guard)', () => {
    const metrics = createTeamMetrics(1);
    const json = buildMetricsJSON(metrics);
    expect(json.avg_rejection_cycles).toBe(0.0);
    expect(json.tasks_completed).toBe(0);
  });

  test('per-builder entry has tasks, first_pass_approvals, rejections, total_review_cycles, first_pass_rate', () => {
    const metrics = buildMetricsFromTasks(1, [
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
      { builder_agent: 'backend-developer', rejection_cycles: 1 },
    ]);
    const json = buildMetricsJSON(metrics);
    const bd = json.builders['backend-developer'];
    expect(bd).toHaveProperty('tasks');
    expect(bd).toHaveProperty('first_pass_approvals');
    expect(bd).toHaveProperty('rejections');
    // total_review_cycles is an alias for rejections (same value, explicit field name)
    expect(bd).toHaveProperty('total_review_cycles');
    expect(bd.total_review_cycles).toBe(bd.rejections);
    expect(bd).toHaveProperty('first_pass_rate');
  });

  test('per-builder first_pass_rate = (first_pass_approvals / tasks) * 100', () => {
    const metrics = buildMetricsFromTasks(1, [
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
      { builder_agent: 'backend-developer', rejection_cycles: 1 },
      { builder_agent: 'backend-developer', rejection_cycles: 1 },
    ]);
    const json = buildMetricsJSON(metrics);
    expect(json.builders['backend-developer'].tasks).toBe(4);
    expect(json.builders['backend-developer'].first_pass_approvals).toBe(2);
    expect(json.builders['backend-developer'].first_pass_rate).toBe(50.0);
  });

  test('top-level first_pass_rate matches same formula as formatPhaseSummary', () => {
    const metrics = buildMetricsFromTasks(1, [
      { builder_agent: 'backend-developer',  rejection_cycles: 0 },
      { builder_agent: 'frontend-developer', rejection_cycles: 0 },
      { builder_agent: 'backend-developer',  rejection_cycles: 1 },
    ]);
    const json = buildMetricsJSON(metrics);
    // 2 first-pass out of 3 tasks
    expect(json.first_pass_rate).toBeCloseTo((2 / 3) * 100, 5);
  });
});

// ===========================================================================
// Tests: Metrics persistence format (TRD-035 step 3)
// ===========================================================================

describe('TRD-035: formatEpicComment', () => {
  let metrics;

  beforeEach(() => {
    metrics = buildMetricsFromTasks(2, [
      { builder_agent: 'backend-developer',  rejection_cycles: 0 },
      { builder_agent: 'frontend-developer', rejection_cycles: 2 },
      { builder_agent: 'backend-developer',  rejection_cycles: 0 },
    ]);
  });

  test('starts with team-metrics:phase-<N>', () => {
    const comment = formatEpicComment(metrics);
    expect(comment).toMatch(/^team-metrics:phase-2/);
  });

  test('contains tasks:<N>', () => {
    const comment = formatEpicComment(metrics);
    expect(comment).toContain('tasks:3');
  });

  test('contains first-pass-rate:<X>%', () => {
    const comment = formatEpicComment(metrics);
    expect(comment).toContain('first-pass-rate:');
    expect(comment).toContain('%');
  });

  test('contains total-rejections:<N>', () => {
    const comment = formatEpicComment(metrics);
    expect(comment).toContain('total-rejections:2');
  });

  test('contains builders: followed by JSON', () => {
    const comment = formatEpicComment(metrics);
    expect(comment).toContain('builders:');
    const buildersIdx = comment.indexOf(' builders:');
    const buildersRaw = comment.substring(buildersIdx + ' builders:'.length);
    expect(() => JSON.parse(buildersRaw)).not.toThrow();
    const parsed = JSON.parse(buildersRaw);
    expect(parsed).toHaveProperty('builders');
  });
});

// ===========================================================================
// Tests: Cross-session resume (TRD-044 AC-TM-4)
// ===========================================================================

describe('TRD-044 AC-TM-4: parseMetricsFromComment', () => {
  test('round-trip: buildMetricsJSON -> formatEpicComment -> parseMetricsFromComment -> same values', () => {
    const original = buildMetricsFromTasks(3, [
      { builder_agent: 'backend-developer',  rejection_cycles: 0 },
      { builder_agent: 'frontend-developer', rejection_cycles: 1 },
      { builder_agent: 'backend-developer',  rejection_cycles: 0 },
      { builder_agent: 'backend-developer',  rejection_cycles: 2 },
    ]);

    const comment = formatEpicComment(original);
    const parsed = parseMetricsFromComment(comment);

    expect(parsed).not.toBeNull();
    expect(parsed.phase).toBe(original.phase);
    expect(parsed.tasks_completed).toBe(original.tasks_completed);
    expect(parsed.total_rejections).toBe(3); // 0+1+0+2
    expect(parsed.first_pass_rate).toBeCloseTo((2 / 4) * 100, 5);
    expect(parsed.builders).not.toBeNull();
    expect(parsed.builders['backend-developer']).toBeDefined();
    expect(parsed.builders['frontend-developer']).toBeDefined();
  });

  test('partial comment (missing builders field) -> builders is null', () => {
    const partial = 'team-metrics:phase-1 tasks:2 first-pass-rate:50% total-rejections:1';
    const parsed = parseMetricsFromComment(partial);
    expect(parsed).not.toBeNull();
    expect(parsed.phase).toBe(1);
    expect(parsed.tasks_completed).toBe(2);
    expect(parsed.builders).toBeNull();
  });

  test('comment not starting with team-metrics:phase- returns null', () => {
    expect(parseMetricsFromComment('status:in_progress assigned:backend-developer')).toBeNull();
  });

  test('null input returns null', () => {
    expect(parseMetricsFromComment(null)).toBeNull();
  });

  test('empty string returns null', () => {
    expect(parseMetricsFromComment('')).toBeNull();
  });

  test('round-trip avg_rejection_cycles is preserved', () => {
    const original = buildMetricsFromTasks(1, [
      { builder_agent: 'backend-developer', rejection_cycles: 3 },
      { builder_agent: 'backend-developer', rejection_cycles: 1 },
    ]);
    const comment = formatEpicComment(original);
    const parsed = parseMetricsFromComment(comment);
    // avg = (3+1)/2 = 2.0
    expect(parsed.avg_rejection_cycles).toBe(2.0);
  });

  test('round-trip with zero rejections preserves 100% first-pass-rate', () => {
    const original = buildMetricsFromTasks(1, [
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
    ]);
    const comment = formatEpicComment(original);
    const parsed = parseMetricsFromComment(comment);
    expect(parsed.first_pass_rate).toBe(100.0);
    expect(parsed.total_rejections).toBe(0);
  });

  test('round-trip per-builder first_pass_rate is preserved', () => {
    const original = buildMetricsFromTasks(2, [
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
      { builder_agent: 'backend-developer', rejection_cycles: 0 },
      { builder_agent: 'backend-developer', rejection_cycles: 1 },
    ]);
    const comment = formatEpicComment(original);
    const parsed = parseMetricsFromComment(comment);
    expect(parsed.builders['backend-developer'].first_pass_rate).toBeCloseTo(
      (2 / 3) * 100,
      5
    );
  });
});
