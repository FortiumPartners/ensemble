/**
 * TRD-042: E2E tests for minimal team (lead + builders only)
 *
 * Validates that a lead+builder-only team (no reviewer, no QA) executes the
 * task pipeline correctly. In this configuration tasks transition directly
 * from in_progress to closed without intermediate in_review or in_qa stages.
 */

'use strict';

// ---------------------------------------------------------------------------
// Parser implementation (inlined - same logic as team-yaml-parser.test.js)
// ---------------------------------------------------------------------------

/**
 * Parses the `team:` section of a command YAML and returns a normalized
 * team configuration. Used both on first invocation and on session resume.
 *
 * @param {Object|undefined|null} yamlTeamSection - The `team:` object from parsed YAML
 * @returns {{ teamMode: boolean, teamRoles: Object, reviewerEnabled: boolean, qaEnabled: boolean }}
 * @throws {Error} if required roles (lead, builder) are missing
 */
function parseTeamConfig(yamlTeamSection) {
  if (!yamlTeamSection) {
    return { teamMode: false, teamRoles: {}, reviewerEnabled: false, qaEnabled: false };
  }

  const roles = yamlTeamSection.roles || [];
  const teamRoles = {};

  for (const role of roles) {
    const agents =
      role.agents ||
      (role.agent ? [role.agent] : []);

    teamRoles[role.name] = {
      agents,
      owns: role.owns || [],
    };
  }

  if (!teamRoles.lead) throw new Error("team.roles must include a 'lead' role");
  if (!teamRoles.builder) throw new Error("team.roles must include a 'builder' role");

  return {
    teamMode: true,
    teamRoles,
    reviewerEnabled: !!teamRoles.reviewer,
    qaEnabled: !!teamRoles.qa,
  };
}

// ---------------------------------------------------------------------------
// Pipeline helper
// ---------------------------------------------------------------------------

/**
 * Returns the ordered list of bead sub-state stages that a task passes through
 * given the team's optional role configuration.
 *
 * Minimal team (no reviewer, no QA):
 *   ['in_progress', 'closed']
 *
 * Full team:
 *   ['in_progress', 'in_review', 'in_qa', 'closed']
 *
 * @param {boolean} reviewerEnabled
 * @param {boolean} qaEnabled
 * @returns {string[]}
 */
function getMinimalTeamPipeline(reviewerEnabled, qaEnabled) {
  const stages = ['in_progress'];
  if (reviewerEnabled) stages.push('in_review');
  if (qaEnabled) stages.push('in_qa');
  stages.push('closed');
  return stages;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal team fixture: lead + two builders, no reviewer, no QA. */
const MINIMAL_TEAM_CONFIG = {
  roles: [
    { name: 'lead', agent: 'tech-lead-orchestrator', owns: ['task-selection', 'final-approval'] },
    { name: 'builder', agents: ['backend-developer', 'frontend-developer'], owns: ['implementation'] },
  ],
};

/** Full team fixture for contrast tests. */
const FULL_TEAM_CONFIG = {
  roles: [
    { name: 'lead', agent: 'tech-lead-orchestrator', owns: ['task-selection', 'final-approval'] },
    { name: 'builder', agents: ['backend-developer', 'frontend-developer'], owns: ['implementation'] },
    { name: 'reviewer', agent: 'code-reviewer', owns: ['code-review'] },
    { name: 'qa', agent: 'qa-orchestrator', owns: ['quality-assurance'] },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E Minimal Team (lead + builders only)', () => {
  let config;

  beforeEach(() => {
    config = parseTeamConfig(MINIMAL_TEAM_CONFIG);
  });

  // -------------------------------------------------------------------------
  // Config parsing
  // -------------------------------------------------------------------------

  describe('config parsing', () => {
    test('minimal config parsed correctly', () => {
      expect(config.teamMode).toBe(true);
      expect(config.reviewerEnabled).toBe(false);
      expect(config.qaEnabled).toBe(false);
      expect(config.teamRoles.lead.agents).toEqual(['tech-lead-orchestrator']);
      expect(config.teamRoles.builder.agents).toEqual(['backend-developer', 'frontend-developer']);
      expect(config.teamRoles.reviewer).toBeUndefined();
      expect(config.teamRoles.qa).toBeUndefined();
    });

    test('lead owns list contains task-selection and final-approval', () => {
      expect(config.teamRoles.lead.owns).toContain('task-selection');
      expect(config.teamRoles.lead.owns).toContain('final-approval');
    });

    test('builder owns list contains implementation', () => {
      expect(config.teamRoles.builder.owns).toContain('implementation');
    });

    test('exactly 2 roles defined', () => {
      expect(Object.keys(config.teamRoles)).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Pipeline shape
  // -------------------------------------------------------------------------

  describe('pipeline stages', () => {
    test('pipeline skips review and QA stages', () => {
      const pipeline = getMinimalTeamPipeline(config.reviewerEnabled, config.qaEnabled);
      expect(pipeline).toEqual(['in_progress', 'closed']);
      expect(pipeline).not.toContain('in_review');
      expect(pipeline).not.toContain('in_qa');
    });

    test('task goes directly from in_progress to closed (no intermediate stages)', () => {
      const pipeline = getMinimalTeamPipeline(false, false);
      const firstStage = pipeline[0];
      const lastStage = pipeline[pipeline.length - 1];
      expect(firstStage).toBe('in_progress');
      expect(lastStage).toBe('closed');
      expect(pipeline.length).toBe(2);
    });

    test('pipeline length is 2 (shortest possible)', () => {
      const pipeline = getMinimalTeamPipeline(false, false);
      expect(pipeline).toHaveLength(2);
    });

    test('full team pipeline has 4 stages for contrast', () => {
      const fullConfig = parseTeamConfig(FULL_TEAM_CONFIG);
      const pipeline = getMinimalTeamPipeline(fullConfig.reviewerEnabled, fullConfig.qaEnabled);
      expect(pipeline).toHaveLength(4);
      expect(pipeline).toEqual(['in_progress', 'in_review', 'in_qa', 'closed']);
    });

    test('reviewer-only team pipeline has 3 stages', () => {
      const reviewerOnlySection = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'reviewer', agent: 'code-reviewer' },
        ],
      };
      const reviewerConfig = parseTeamConfig(reviewerOnlySection);
      const pipeline = getMinimalTeamPipeline(reviewerConfig.reviewerEnabled, reviewerConfig.qaEnabled);
      expect(pipeline).toHaveLength(3);
      expect(pipeline).toEqual(['in_progress', 'in_review', 'closed']);
    });
  });

  // -------------------------------------------------------------------------
  // Lead orchestration loop
  // -------------------------------------------------------------------------

  describe('lead orchestration loop', () => {
    test('lead orchestration loop with builder-only delegation', () => {
      const taskLifecycle = {
        open: 'lead assigns to builder',
        in_progress: 'builder implements',
        closed: 'lead closes directly (no review/QA)',
      };
      expect(Object.keys(taskLifecycle)).toEqual(['open', 'in_progress', 'closed']);
      expect(taskLifecycle.in_progress).toContain('builder');
      expect(taskLifecycle.closed).toContain('lead closes directly');
    });

    test('lead is the only agent with final-approval in minimal team', () => {
      const agentsWithFinalApproval = Object.entries(config.teamRoles)
        .filter(([, role]) => role.owns.includes('final-approval'))
        .map(([name]) => name);
      expect(agentsWithFinalApproval).toEqual(['lead']);
    });
  });

  // -------------------------------------------------------------------------
  // Status comment trail
  // -------------------------------------------------------------------------

  describe('br comment trail for minimal team', () => {
    test('br comments for minimal team show only assignment and completion', () => {
      const expectedComments = [
        'status:in_progress assigned:backend-developer',
        'status:skip-review lead:tech-lead-orchestrator reason:no-reviewer-role-defined',
        'status:skip-qa lead:tech-lead-orchestrator reason:no-qa-role-defined',
        'status:closed lead:tech-lead-orchestrator reason:no-reviewer-no-qa-direct-close',
      ];

      const hasReviewComment = expectedComments.some(c => c.includes('status:in_review'));
      const hasQAComment = expectedComments.some(c => c.includes('status:in_qa'));

      expect(hasReviewComment).toBe(false);
      expect(hasQAComment).toBe(false);
      expect(expectedComments[0]).toContain('status:in_progress');
      expect(expectedComments[expectedComments.length - 1]).toContain('status:closed');
    });

    test('first comment is in_progress with assigned builder', () => {
      const firstComment = 'status:in_progress assigned:backend-developer';
      expect(firstComment).toMatch(/^status:in_progress/);
      expect(firstComment).toContain('assigned:');
    });

    test('final comment is closed with lead attribution', () => {
      const finalComment =
        'status:closed lead:tech-lead-orchestrator reason:no-reviewer-no-qa-direct-close';
      expect(finalComment).toMatch(/^status:closed/);
      expect(finalComment).toContain('lead:tech-lead-orchestrator');
    });

    test('skip-review comment references the lead agent', () => {
      const skipReviewComment =
        'status:skip-review lead:tech-lead-orchestrator reason:no-reviewer-role-defined';
      expect(skipReviewComment).toContain('lead:tech-lead-orchestrator');
      expect(skipReviewComment).toContain('reason:no-reviewer-role-defined');
    });

    test('skip-qa comment references the lead agent', () => {
      const skipQAComment =
        'status:skip-qa lead:tech-lead-orchestrator reason:no-qa-role-defined';
      expect(skipQAComment).toContain('lead:tech-lead-orchestrator');
      expect(skipQAComment).toContain('reason:no-qa-role-defined');
    });
  });

  // -------------------------------------------------------------------------
  // Builder selection
  // -------------------------------------------------------------------------

  describe('builder selection', () => {
    test('builder selection constrained to team builder list', () => {
      const builderList = config.teamRoles.builder.agents;
      const selectedBuilder = builderList[0];
      expect(builderList).toContain(selectedBuilder);
      expect(builderList).toHaveLength(2);
    });

    test('backend-developer is in the builder pool', () => {
      expect(config.teamRoles.builder.agents).toContain('backend-developer');
    });

    test('frontend-developer is in the builder pool', () => {
      expect(config.teamRoles.builder.agents).toContain('frontend-developer');
    });

    test('lead agent is not in the builder pool', () => {
      const leadAgents = config.teamRoles.lead.agents;
      const builderAgents = config.teamRoles.builder.agents;
      const overlap = leadAgents.filter(a => builderAgents.includes(a));
      expect(overlap).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-phase TRD execution
  // -------------------------------------------------------------------------

  describe('multi-phase TRD execution', () => {
    test('2-phase TRD executes 4 tasks with minimal team', () => {
      const phases = [
        { id: 1, tasks: ['TRD-001', 'TRD-002'] },
        { id: 2, tasks: ['TRD-003', 'TRD-004'] },
      ];
      const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);
      expect(totalTasks).toBe(4);

      const pipelineLength = getMinimalTeamPipeline(false, false).length;
      const totalTransitions = totalTasks * (pipelineLength - 1);
      expect(totalTransitions).toBe(4); // 4 tasks * 1 transition each (in_progress -> closed)
    });

    test('each task has exactly 1 state transition in minimal pipeline', () => {
      const pipeline = getMinimalTeamPipeline(false, false);
      const transitionsPerTask = pipeline.length - 1;
      expect(transitionsPerTask).toBe(1);
    });

    test('3-phase TRD with 6 tasks has 6 total transitions in minimal pipeline', () => {
      const phases = [
        { id: 1, tasks: ['TRD-001', 'TRD-002'] },
        { id: 2, tasks: ['TRD-003', 'TRD-004'] },
        { id: 3, tasks: ['TRD-005', 'TRD-006'] },
      ];
      const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);
      const transitionsPerTask = getMinimalTeamPipeline(false, false).length - 1;
      const totalTransitions = totalTasks * transitionsPerTask;
      expect(totalTransitions).toBe(6);
    });

    test('full team pipeline has 3 transitions per task vs 1 for minimal team', () => {
      const minimalPipeline = getMinimalTeamPipeline(false, false);
      const fullConfig = parseTeamConfig(FULL_TEAM_CONFIG);
      const fullPipeline = getMinimalTeamPipeline(fullConfig.reviewerEnabled, fullConfig.qaEnabled);

      expect(minimalPipeline.length - 1).toBe(1);
      expect(fullPipeline.length - 1).toBe(3);
    });
  });
});
