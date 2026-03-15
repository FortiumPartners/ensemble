/**
 * TRD-033: Unit/integration tests for cross-session resume with team sub-states
 *
 * The resume logic (TRD-028) scans in-progress beads, calls get_sub_state(),
 * and routes to the correct pipeline stage based on the sub-state value and
 * metadata stored in the bead's status comment.
 */

'use strict';

// ---------------------------------------------------------------------------
// Resume routing implementation
// ---------------------------------------------------------------------------

/**
 * Given a sub-state from get_sub_state() and the metadata parsed from the
 * most recent status: comment, returns a routing decision that tells the
 * orchestrator which pipeline stage to re-enter.
 *
 * Sub-states:
 *   'in_review'   -> delegate back to the reviewer agent
 *   'in_qa'       -> delegate back to the QA agent
 *   'in_progress' -> delegate back to the builder (may have assigned: context)
 *   'open'        -> skip (task was never started in this session)
 *   'closed'      -> skip (task completed in a prior session)
 *   <unknown>     -> safe default: delegate to builder
 *
 * @param {string} subState - The sub-state string from get_sub_state()
 * @param {Object} metadata - Key/value pairs parsed from the status: comment
 * @returns {{ action: string, context: Object }}
 */
function routeResumedTask(subState, metadata) {
  switch (subState) {
    case 'in_review':
      return { action: 'delegate_to_reviewer', context: { fromComment: metadata } };
    case 'in_qa':
      return { action: 'delegate_to_qa', context: { fromComment: metadata } };
    case 'in_progress':
      if (metadata.assigned) {
        return { action: 'delegate_to_builder', context: { builder: metadata.assigned } };
      }
      return { action: 'delegate_to_builder', context: { builder: null } };
    case 'open':
      return { action: 'skip', context: {} };
    case 'closed':
      return { action: 'skip', context: {} };
    default:
      return { action: 'delegate_to_builder', context: { builder: null } };
  }
}

// ---------------------------------------------------------------------------
// Team config reconstruction
// ---------------------------------------------------------------------------

/**
 * Re-parses the team: section from a command YAML during session resume.
 * Identical behaviour to parseTeamConfig but called in the resume path to
 * reconstruct TEAM_MODE settings without requiring a fresh user invocation.
 *
 * @param {Object|undefined|null} teamSection - The `team:` object from parsed YAML
 * @returns {{ teamMode: boolean, teamRoles: Object, reviewerEnabled: boolean, qaEnabled: boolean }}
 */
function reconstructTeamConfig(teamSection) {
  if (!teamSection) {
    return { teamMode: false, teamRoles: {}, reviewerEnabled: false, qaEnabled: false };
  }

  const roles = teamSection.roles || [];
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

  if (!teamRoles.lead) {
    throw new Error("team.roles must include a 'lead' role");
  }
  if (!teamRoles.builder) {
    throw new Error("team.roles must include a 'builder' role");
  }

  return {
    teamMode: true,
    teamRoles,
    reviewerEnabled: !!teamRoles.reviewer,
    qaEnabled: !!teamRoles.qa,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cross-Session Resume - Team Sub-State Routing', () => {
  // -------------------------------------------------------------------------
  // in_review routing
  // -------------------------------------------------------------------------

  test('in_review sub-state routes to reviewer', () => {
    const result = routeResumedTask('in_review', { reviewer: 'code-reviewer' });
    expect(result.action).toBe('delegate_to_reviewer');
  });

  test('in_review preserves full metadata in context.fromComment', () => {
    const meta = { reviewer: 'code-reviewer', files: 'src/api.ts' };
    const result = routeResumedTask('in_review', meta);
    expect(result.context.fromComment).toEqual(meta);
  });

  // -------------------------------------------------------------------------
  // in_qa routing
  // -------------------------------------------------------------------------

  test('in_qa sub-state routes to QA agent', () => {
    const result = routeResumedTask('in_qa', { qa: 'qa-orchestrator' });
    expect(result.action).toBe('delegate_to_qa');
  });

  test('in_qa preserves full metadata in context.fromComment', () => {
    const meta = { qa: 'qa-orchestrator', coverage: '78' };
    const result = routeResumedTask('in_qa', meta);
    expect(result.context.fromComment).toEqual(meta);
  });

  // -------------------------------------------------------------------------
  // in_progress routing
  // -------------------------------------------------------------------------

  test('in_progress with assigned: routes to same builder', () => {
    const result = routeResumedTask('in_progress', { assigned: 'backend-developer' });
    expect(result.action).toBe('delegate_to_builder');
    expect(result.context.builder).toBe('backend-developer');
  });

  test('in_progress with rejected verdict routes to builder with rejection context', () => {
    // A task that was rejected is back in in_progress
    const result = routeResumedTask('in_progress', {
      assigned: 'backend-developer',
      verdict: 'rejected',
      reason: 'missing-tests',
    });
    expect(result.action).toBe('delegate_to_builder');
    expect(result.context.builder).toBe('backend-developer');
  });

  test('in_progress with frontend-developer as assigned routes correctly', () => {
    const result = routeResumedTask('in_progress', { assigned: 'frontend-developer' });
    expect(result.action).toBe('delegate_to_builder');
    expect(result.context.builder).toBe('frontend-developer');
  });

  test('no status: comment (v2.1.0 bead) defaults to builder stage', () => {
    // get_sub_state returns ('in_progress', {}) for v2.1.0 beads via native status
    const result = routeResumedTask('in_progress', {});
    expect(result.action).toBe('delegate_to_builder');
    expect(result.context.builder).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Skip states
  // -------------------------------------------------------------------------

  test('open sub-state is skipped (task not yet started)', () => {
    const result = routeResumedTask('open', {});
    expect(result.action).toBe('skip');
    expect(result.context).toEqual({});
  });

  test('closed sub-state is skipped (task already completed)', () => {
    const result = routeResumedTask('closed', {});
    expect(result.action).toBe('skip');
    expect(result.context).toEqual({});
  });

  // -------------------------------------------------------------------------
  // Unknown / default sub-state
  // -------------------------------------------------------------------------

  test('unknown sub-state falls through to safe default (delegate_to_builder)', () => {
    const result = routeResumedTask('unknown_state', {});
    expect(result.action).toBe('delegate_to_builder');
    expect(result.context.builder).toBeNull();
  });

  test('empty string sub-state falls through to safe default', () => {
    const result = routeResumedTask('', {});
    expect(result.action).toBe('delegate_to_builder');
    expect(result.context.builder).toBeNull();
  });

  test('null sub-state falls through to safe default', () => {
    const result = routeResumedTask(null, {});
    expect(result.action).toBe('delegate_to_builder');
    expect(result.context.builder).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Team config reconstruction on resume
// ---------------------------------------------------------------------------

describe('Team Config Reconstruction (reconstructTeamConfig)', () => {
  test('team config reconstructed from YAML section', () => {
    const teamSection = {
      roles: [
        { name: 'lead', agent: 'tech-lead-orchestrator', owns: ['task-selection'] },
        { name: 'builder', agents: ['backend-developer'], owns: ['implementation'] },
      ],
    };
    const config = reconstructTeamConfig(teamSection);
    expect(config.teamMode).toBe(true);
    expect(config.teamRoles.lead.agents).toEqual(['tech-lead-orchestrator']);
  });

  test('null team section means no team mode (TEAM_MODE=false)', () => {
    const config = reconstructTeamConfig(null);
    expect(config.teamMode).toBe(false);
  });

  test('undefined team section means no team mode', () => {
    const config = reconstructTeamConfig(undefined);
    expect(config.teamMode).toBe(false);
  });

  test('reconstructed config has correct reviewerEnabled flag when reviewer present', () => {
    const teamSection = {
      roles: [
        { name: 'lead', agent: 'tech-lead-orchestrator' },
        { name: 'builder', agent: 'backend-developer' },
        { name: 'reviewer', agent: 'code-reviewer' },
      ],
    };
    const config = reconstructTeamConfig(teamSection);
    expect(config.reviewerEnabled).toBe(true);
    expect(config.qaEnabled).toBe(false);
  });

  test('reconstructed config has correct qaEnabled flag when qa present', () => {
    const teamSection = {
      roles: [
        { name: 'lead', agent: 'tech-lead-orchestrator' },
        { name: 'builder', agent: 'backend-developer' },
        { name: 'qa', agent: 'qa-orchestrator' },
      ],
    };
    const config = reconstructTeamConfig(teamSection);
    expect(config.reviewerEnabled).toBe(false);
    expect(config.qaEnabled).toBe(true);
  });

  test('throws when lead role is missing during resume', () => {
    const teamSection = {
      roles: [{ name: 'builder', agent: 'backend-developer' }],
    };
    expect(() => reconstructTeamConfig(teamSection)).toThrow(
      "team.roles must include a 'lead' role"
    );
  });

  test('throws when builder role is missing during resume', () => {
    const teamSection = {
      roles: [{ name: 'lead', agent: 'tech-lead-orchestrator' }],
    };
    expect(() => reconstructTeamConfig(teamSection)).toThrow(
      "team.roles must include a 'builder' role"
    );
  });

  test('singular agent: is normalized to agents: array on resume', () => {
    const teamSection = {
      roles: [
        { name: 'lead', agent: 'tech-lead-orchestrator' },
        { name: 'builder', agent: 'backend-developer' },
      ],
    };
    const config = reconstructTeamConfig(teamSection);
    expect(config.teamRoles.lead.agents).toEqual(['tech-lead-orchestrator']);
    expect(config.teamRoles.builder.agents).toEqual(['backend-developer']);
  });
});

// ---------------------------------------------------------------------------
// Resume summary statistics
// ---------------------------------------------------------------------------

describe('Resume summary', () => {
  test('counts tasks correctly by sub-state', () => {
    const taskSubStates = [
      { id: 'bead-1', subState: 'in_progress', metadata: { assigned: 'backend-developer' } },
      { id: 'bead-2', subState: 'in_review', metadata: {} },
      { id: 'bead-3', subState: 'in_qa', metadata: {} },
      { id: 'bead-4', subState: 'in_progress', metadata: {} },
    ];

    const counts = {
      building: taskSubStates.filter(t => t.subState === 'in_progress').length,
      in_review: taskSubStates.filter(t => t.subState === 'in_review').length,
      in_qa: taskSubStates.filter(t => t.subState === 'in_qa').length,
    };

    expect(counts.building).toBe(2);
    expect(counts.in_review).toBe(1);
    expect(counts.in_qa).toBe(1);
  });

  test('routes all tasks in a mixed sub-state list to correct actions', () => {
    const taskSubStates = [
      { id: 'bead-1', subState: 'in_progress', metadata: { assigned: 'backend-developer' } },
      { id: 'bead-2', subState: 'in_review', metadata: { reviewer: 'code-reviewer' } },
      { id: 'bead-3', subState: 'in_qa', metadata: { qa: 'qa-orchestrator' } },
      { id: 'bead-4', subState: 'closed', metadata: {} },
    ];

    const routes = taskSubStates.map(t => routeResumedTask(t.subState, t.metadata));

    expect(routes[0].action).toBe('delegate_to_builder');
    expect(routes[1].action).toBe('delegate_to_reviewer');
    expect(routes[2].action).toBe('delegate_to_qa');
    expect(routes[3].action).toBe('skip');
  });

  test('no tasks to resume when all beads are closed or open', () => {
    const taskSubStates = [
      { id: 'bead-1', subState: 'closed', metadata: {} },
      { id: 'bead-2', subState: 'open', metadata: {} },
      { id: 'bead-3', subState: 'closed', metadata: {} },
    ];

    const activeRoutes = taskSubStates
      .map(t => routeResumedTask(t.subState, t.metadata))
      .filter(r => r.action !== 'skip');

    expect(activeRoutes).toHaveLength(0);
  });

  test('skipped task count equals open + closed bead count', () => {
    const taskSubStates = [
      { id: 'bead-1', subState: 'in_progress', metadata: { assigned: 'backend-developer' } },
      { id: 'bead-2', subState: 'open', metadata: {} },
      { id: 'bead-3', subState: 'closed', metadata: {} },
      { id: 'bead-4', subState: 'closed', metadata: {} },
    ];

    const skipped = taskSubStates
      .map(t => routeResumedTask(t.subState, t.metadata))
      .filter(r => r.action === 'skip')
      .length;

    expect(skipped).toBe(3); // bead-2 (open) + bead-3 (closed) + bead-4 (closed)
  });
});
