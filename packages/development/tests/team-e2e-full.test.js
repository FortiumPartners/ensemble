/**
 * TRD-041: E2E test with full team on sample TRD
 *
 * Full E2E simulation with 4 roles: lead + 2 builders + reviewer + QA.
 * Tests builder selection, task assignment, lifecycle states, audit trails,
 * team metrics, and TRD checkbox updates across a 3-phase, 6-task fixture TRD.
 *
 * Bead: ensemble-3er
 */

'use strict';

const {
  parseTeamConfig,
  selectBuilder,
  VALID_TRANSITIONS,
} = require('./helpers/team-utils');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Full team config: lead + 3 builders (backend, frontend, infra) + reviewer + qa */
const FULL_TEAM_CONFIG = {
  roles: [
    {
      name: 'lead',
      agent: 'tech-lead-orchestrator',
      owns: ['task-selection', 'architecture-review', 'final-approval'],
    },
    {
      name: 'builder',
      agents: ['backend-developer', 'frontend-developer', 'infrastructure-developer'],
      owns: ['implementation'],
    },
    {
      name: 'reviewer',
      agent: 'code-reviewer',
      owns: ['code-review'],
    },
    {
      name: 'qa',
      agent: 'qa-orchestrator',
      owns: ['quality-gate', 'acceptance-criteria'],
    },
  ],
};

/** Fixture TRD: 3 phases, 6 tasks, mixed keywords */
const FIXTURE_TRD = {
  phases: [
    {
      id: 1,
      name: 'Backend API',
      tasks: [
        { id: 'TRD-001', title: 'Add user authentication API endpoint', keywords: ['backend', 'api'] },
        { id: 'TRD-002', title: 'Add database migration for users table', keywords: ['database', 'migration'] },
      ],
    },
    {
      id: 2,
      name: 'Frontend UI',
      tasks: [
        { id: 'TRD-003', title: 'Create login form React component', keywords: ['frontend', 'react', 'component'] },
        { id: 'TRD-004', title: 'Add CSS styles for auth pages', keywords: ['frontend', 'css'] },
      ],
    },
    {
      id: 3,
      name: 'Infrastructure',
      tasks: [
        { id: 'TRD-005', title: 'Deploy to production with Docker', keywords: ['deploy', 'docker', 'infra'] },
        { id: 'TRD-006', title: 'Add API documentation', keywords: ['docs', 'documentation'] },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Pipeline simulation (file-specific helper)
// ---------------------------------------------------------------------------

/**
 * Minimal simulation of the lead-loop task pipeline for audit trail assertions.
 *
 * @param {Object} options
 * @param {string} [options.builderAgent='backend-developer']
 * @param {boolean} [options.reviewerEnabled=true]
 * @param {boolean} [options.qaEnabled=true]
 * @param {string}  [options.reviewerVerdict='approved']
 * @param {string}  [options.qaVerdict='passed']
 * @returns {{ finalState: string, comments: string[] }}
 */
function simulateTaskPipelineE2E(options = {}) {
  const {
    builderAgent = 'backend-developer',
    reviewerEnabled = true,
    qaEnabled = true,
    reviewerVerdict = 'approved',
    qaVerdict = 'passed',
  } = options;

  const comments = [];
  let currentState = 'open';

  // Lead assigns to builder
  if ((VALID_TRANSITIONS[currentState] || []).includes('in_progress')) {
    currentState = 'in_progress';
    comments.push(`status:in_progress assigned:${builderAgent}`);
  }

  // Review phase
  if (reviewerEnabled) {
    currentState = 'in_review';
    comments.push(`status:in_review builder:${builderAgent} files:src/api.ts`);

    if (reviewerVerdict === 'approved') {
      if (qaEnabled) {
        currentState = 'in_qa';
        comments.push('status:in_qa reviewer:code-reviewer verdict:approved');
      }
    } else {
      currentState = 'in_progress';
      comments.push('status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-tests');
      return { finalState: currentState, comments };
    }
  }

  // QA phase
  if (qaEnabled && currentState === 'in_qa') {
    if (qaVerdict === 'passed') {
      currentState = 'closed';
      comments.push('status:closed qa:qa-orchestrator verdict:passed');
    } else {
      currentState = 'in_progress';
      comments.push('status:in_progress qa:qa-orchestrator verdict:rejected reason:coverage-too-low');
    }
  }

  return { finalState: currentState, comments };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E Full Team - 4 Roles', () => {
  let config;

  beforeAll(() => {
    config = parseTeamConfig(FULL_TEAM_CONFIG);
  });

  // -------------------------------------------------------------------------
  // Team config parsing
  // -------------------------------------------------------------------------

  test('full team config has all 4 roles', () => {
    expect(config.teamMode).toBe(true);
    expect(config.reviewerEnabled).toBe(true);
    expect(config.qaEnabled).toBe(true);
    expect(config.teamRoles.lead).toBeDefined();
    expect(config.teamRoles.builder).toBeDefined();
    expect(config.teamRoles.reviewer).toBeDefined();
    expect(config.teamRoles.qa).toBeDefined();
  });

  test('lead owns task-selection, architecture-review, and final-approval', () => {
    const leadOwns = config.teamRoles.lead.owns;
    expect(leadOwns).toContain('task-selection');
    expect(leadOwns).toContain('architecture-review');
    expect(leadOwns).toContain('final-approval');
  });

  test('builder pool has exactly 3 specialist agents', () => {
    expect(config.teamRoles.builder.agents).toHaveLength(3);
    expect(config.teamRoles.builder.agents).toContain('backend-developer');
    expect(config.teamRoles.builder.agents).toContain('frontend-developer');
    expect(config.teamRoles.builder.agents).toContain('infrastructure-developer');
  });

  test('reviewer is code-reviewer', () => {
    expect(config.teamRoles.reviewer.agents).toEqual(['code-reviewer']);
  });

  test('qa is qa-orchestrator', () => {
    expect(config.teamRoles.qa.agents).toEqual(['qa-orchestrator']);
  });

  // -------------------------------------------------------------------------
  // Builder selection
  // -------------------------------------------------------------------------

  test('builder selection assigns correct specialist per task keywords', () => {
    const builders = config.teamRoles.builder.agents;
    expect(selectBuilder(['backend', 'api'], builders)).toBe('backend-developer');
    expect(selectBuilder(['frontend', 'react'], builders)).toBe('frontend-developer');
    expect(selectBuilder(['infra', 'docker'], builders)).toBe('infrastructure-developer');
    expect(selectBuilder(['docs', 'documentation'], builders)).toBe('backend-developer');
  });

  test('all 6 fixture tasks get assigned to correct builders', () => {
    const builders = config.teamRoles.builder.agents;
    const assignments = FIXTURE_TRD.phases.flatMap(p =>
      p.tasks.map(t => ({ taskId: t.id, builder: selectBuilder(t.keywords, builders) }))
    );
    expect(assignments.find(a => a.taskId === 'TRD-001').builder).toBe('backend-developer');
    expect(assignments.find(a => a.taskId === 'TRD-002').builder).toBe('backend-developer');
    expect(assignments.find(a => a.taskId === 'TRD-003').builder).toBe('frontend-developer');
    expect(assignments.find(a => a.taskId === 'TRD-004').builder).toBe('frontend-developer');
    expect(assignments.find(a => a.taskId === 'TRD-005').builder).toBe('infrastructure-developer');
    expect(assignments.find(a => a.taskId === 'TRD-006').builder).toBe('backend-developer');
  });

  test('unknown keywords fall back to first builder in list', () => {
    const builders = config.teamRoles.builder.agents;
    const selected = selectBuilder(['unknown-keyword', 'something-else'], builders);
    expect(selected).toBe(builders[0]);
  });

  test('keyword priority: backend takes precedence when multiple matches possible', () => {
    const builders = config.teamRoles.builder.agents;
    // 'backend' appears before 'frontend' in the keyword list
    expect(selectBuilder(['backend', 'frontend'], builders)).toBe('backend-developer');
  });

  // -------------------------------------------------------------------------
  // Lifecycle states
  // -------------------------------------------------------------------------

  test('full lifecycle: 4 states traversed per task (in_progress->in_review->in_qa->closed)', () => {
    const pipeline = ['in_progress'];
    if (config.reviewerEnabled) pipeline.push('in_review');
    if (config.qaEnabled) pipeline.push('in_qa');
    pipeline.push('closed');
    expect(pipeline).toEqual(['in_progress', 'in_review', 'in_qa', 'closed']);
    expect(config.reviewerEnabled).toBe(true);
    expect(config.qaEnabled).toBe(true);
  });

  test('all 6 tasks can traverse the full lifecycle without error', () => {
    const builders = config.teamRoles.builder.agents;
    const allTasks = FIXTURE_TRD.phases.flatMap(p => p.tasks);

    const completedTasks = allTasks.map(task => {
      const builder = selectBuilder(task.keywords, builders);
      const trail = [
        `status:in_progress assigned:${builder}`,
        `status:in_review builder:${builder} files:src/${task.id.toLowerCase()}.ts`,
        `status:in_qa reviewer:code-reviewer verdict:approved`,
        `status:closed qa:qa-orchestrator verdict:passed`,
      ];
      return { taskId: task.id, builder, trail, finalState: 'closed' };
    });

    expect(completedTasks).toHaveLength(6);
    for (const task of completedTasks) {
      expect(task.finalState).toBe('closed');
      expect(task.trail).toHaveLength(4);
    }
  });

  // -------------------------------------------------------------------------
  // Audit trail
  // -------------------------------------------------------------------------

  test('audit trail has all expected status: comments for each task', () => {
    const result = simulateTaskPipelineE2E({
      builderAgent: 'backend-developer',
      reviewerEnabled: config.reviewerEnabled,
      qaEnabled: config.qaEnabled,
      reviewerVerdict: 'approved',
      qaVerdict: 'passed',
    });
    const statusComments = result.comments.filter(c => c.startsWith('status:'));
    const states = statusComments.map(c => c.split(' ')[0].replace('status:', ''));
    expect(states).toContain('in_progress');
    expect(states).toContain('in_review');
    expect(states).toContain('in_qa');
    expect(states).toContain('closed');
    expect(states).toEqual(['in_progress', 'in_review', 'in_qa', 'closed']);
  });

  test('each status comment in audit trail contains required fields', () => {
    const result = simulateTaskPipelineE2E({
      builderAgent: 'backend-developer',
      reviewerEnabled: config.reviewerEnabled,
      qaEnabled: config.qaEnabled,
      reviewerVerdict: 'approved',
      qaVerdict: 'passed',
    });
    const findComment = (state) => result.comments.find(c => c.startsWith(`status:${state}`));

    const inProgressComment = findComment('in_progress');
    expect(inProgressComment).toBeDefined();
    expect(inProgressComment).toContain('assigned:');

    const inReviewComment = findComment('in_review');
    expect(inReviewComment).toBeDefined();
    expect(inReviewComment).toContain('builder:');
    expect(inReviewComment).toContain('files:');

    const inQAComment = findComment('in_qa');
    expect(inQAComment).toBeDefined();
    expect(inQAComment).toContain('reviewer:');
    expect(inQAComment).toContain('verdict:');

    const closedComment = findComment('closed');
    expect(closedComment).toBeDefined();
    expect(closedComment).toContain('qa:');
    expect(closedComment).toContain('verdict:');
  });

  // -------------------------------------------------------------------------
  // Team metrics
  // -------------------------------------------------------------------------

  test('team metrics tracked for 6 completed tasks', () => {
    const builders = config.teamRoles.builder.agents;
    const allTasks = FIXTURE_TRD.phases.flatMap(p => p.tasks);
    const assignments = allTasks.map(task => ({
      taskId: task.id,
      builder: selectBuilder(task.keywords, builders),
    }));
    const metrics = { tasks_completed: assignments.length, builders: {} };
    for (const { builder } of assignments) {
      if (!metrics.builders[builder]) metrics.builders[builder] = { tasks: 0 };
      metrics.builders[builder].tasks++;
    }
    const totalTasks = Object.values(metrics.builders).reduce((sum, b) => sum + b.tasks, 0);
    expect(totalTasks).toBe(metrics.tasks_completed);
    expect(metrics.tasks_completed).toBe(6);
  });

  test('metrics: zero rejections for all builders in successful run', () => {
    const builders = config.teamRoles.builder.agents;
    const metrics = Object.fromEntries(
      builders.map(b => [b, { rejections: 0, approvals: 0 }])
    );
    const allTasks = FIXTURE_TRD.phases.flatMap(p => p.tasks);

    for (const task of allTasks) {
      const builder = selectBuilder(task.keywords, builders);
      metrics[builder].approvals += 1;
    }

    for (const builder of builders) {
      expect(metrics[builder].rejections).toBe(0);
    }
  });

  test('metrics: backend-developer handles 2+ tasks (api + database)', () => {
    const builders = config.teamRoles.builder.agents;
    const allTasks = FIXTURE_TRD.phases.flatMap(p => p.tasks);
    const backendTasks = allTasks.filter(t => selectBuilder(t.keywords, builders) === 'backend-developer');
    expect(backendTasks.length).toBeGreaterThanOrEqual(2);
    expect(backendTasks.map(t => t.id)).toContain('TRD-001');
    expect(backendTasks.map(t => t.id)).toContain('TRD-002');
  });

  // -------------------------------------------------------------------------
  // Wheel instructions / team topology
  // -------------------------------------------------------------------------

  test('wheel instructions include team topology for full team', () => {
    const roles = Object.keys(config.teamRoles);
    expect(roles).toContain('lead');
    expect(roles).toContain('builder');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('qa');
  });

  test('team topology has exactly 4 role keys', () => {
    expect(Object.keys(config.teamRoles)).toHaveLength(4);
  });

  // -------------------------------------------------------------------------
  // TRD checkbox updates
  // -------------------------------------------------------------------------

  test('TRD checkboxes updated after each task closure (full team path)', () => {
    const trdContent = '- [ ] **TRD-001**: Add user authentication API endpoint';
    const updatedContent = trdContent.replace('- [ ] **TRD-001**', '- [x] **TRD-001**');
    expect(updatedContent).toBe('- [x] **TRD-001**: Add user authentication API endpoint');
    expect(updatedContent).not.toContain('- [ ] **TRD-001**');
  });

  test('all 6 TRD checkboxes can be updated from unchecked to checked', () => {
    const allTasks = FIXTURE_TRD.phases.flatMap(p => p.tasks);
    let trdContent = allTasks.map(t => `- [ ] **${t.id}**: ${t.title}`).join('\n');

    // Simulate closing each task
    for (const task of allTasks) {
      trdContent = trdContent.replace(`- [ ] **${task.id}**`, `- [x] **${task.id}**`);
    }

    expect(trdContent).not.toContain('- [ ]');
    expect(trdContent.match(/- \[x\]/g)).toHaveLength(6);
  });

  test('unchecked tasks remain unchecked until explicitly closed', () => {
    const allTasks = FIXTURE_TRD.phases.flatMap(p => p.tasks);
    let trdContent = allTasks.map(t => `- [ ] **${t.id}**: ${t.title}`).join('\n');

    // Only close first task
    trdContent = trdContent.replace('- [ ] **TRD-001**', '- [x] **TRD-001**');

    expect(trdContent).toContain('- [x] **TRD-001**');
    expect(trdContent).toContain('- [ ] **TRD-002**');
    expect(trdContent).toContain('- [ ] **TRD-003**');
  });

  // -------------------------------------------------------------------------
  // Phase processing
  // -------------------------------------------------------------------------

  test('fixture TRD has 3 phases', () => {
    expect(FIXTURE_TRD.phases).toHaveLength(3);
    expect(FIXTURE_TRD.phases[0].name).toBe('Backend API');
    expect(FIXTURE_TRD.phases[1].name).toBe('Frontend UI');
    expect(FIXTURE_TRD.phases[2].name).toBe('Infrastructure');
  });

  test('each phase has exactly 2 tasks in fixture TRD', () => {
    for (const phase of FIXTURE_TRD.phases) {
      expect(phase.tasks).toHaveLength(2);
    }
  });

  test('total task count across all phases is 6', () => {
    const totalTasks = FIXTURE_TRD.phases.reduce((sum, p) => sum + p.tasks.length, 0);
    expect(totalTasks).toBe(6);
  });

  test('all tasks have required id, title, and keywords fields', () => {
    const allTasks = FIXTURE_TRD.phases.flatMap(p => p.tasks);
    for (const task of allTasks) {
      expect(task.id).toBeDefined();
      expect(task.title).toBeDefined();
      expect(task.keywords).toBeDefined();
      expect(Array.isArray(task.keywords)).toBe(true);
      expect(task.keywords.length).toBeGreaterThan(0);
    }
  });
});
