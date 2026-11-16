/**
 * TRD-011: Unit tests for the team YAML parser
 *
 * The parser processes the `team:` section from a command YAML file and
 * returns a normalized team configuration object used to drive TEAM_MODE
 * execution in the implement-trd-tasks workflow.
 */

'use strict';

const { parseTeamConfig } = require('./helpers/team-utils');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Full team config: all 8 roles (lead + builder + reviewer + qa + architect + advisor + pm + documentation) */
const FULL_TEAM_CONFIG = {
  roles: [
    {
      name: 'lead',
      agent: 'tech-lead-orchestrator',
      owns: ['planning', 'escalation', 'skip-decisions'],
    },
    {
      name: 'builder',
      agents: ['backend-developer', 'frontend-developer'],
      owns: ['implementation'],
    },
    {
      name: 'reviewer',
      agent: 'code-reviewer',
      owns: ['code-review'],
    },
    {
      name: 'qa',
      agent: 'test-runner',
      owns: ['quality-assurance'],
    },
    {
      name: 'architect',
      agent: 'architect',
      owns: ['task-design', 'architecture-drift-detection'],
    },
    {
      name: 'advisor',
      agent: 'advisor',
      owns: ['shortcut-detection', 'solution-quality', 'requirement-traceability'],
    },
    {
      name: 'pm',
      agent: 'pm',
      owns: ['requirement-clarification', 'scope-decisions', 'ambiguity-resolution'],
    },
    {
      name: 'documentation',
      agent: 'documentation-specialist',
      owns: ['pr-boundary-doc-maintenance'],
    },
  ],
};

/** Minimal team config: required roles only (lead + builder + architect + documentation) */
const MINIMAL_TEAM_CONFIG = {
  roles: [
    {
      name: 'lead',
      agent: 'tech-lead-orchestrator',
    },
    {
      name: 'builder',
      agent: 'backend-developer',
    },
    {
      name: 'architect',
      agent: 'architect',
    },
    {
      name: 'documentation',
      agent: 'documentation-specialist',
    },
  ],
};
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Team YAML Parser (parseTeamConfig)', () => {
  // -------------------------------------------------------------------------
  // Full configuration
  // -------------------------------------------------------------------------

  describe('full config (all 8 roles)', () => {
    let result;

    beforeEach(() => {
      result = parseTeamConfig(FULL_TEAM_CONFIG);
    });

    test('sets teamMode to true', () => {
      expect(result.teamMode).toBe(true);
    });

    test('sets reviewerEnabled to true', () => {
      expect(result.reviewerEnabled).toBe(true);
    });

    test('sets qaEnabled to true', () => {
      expect(result.qaEnabled).toBe(true);
    });

    test('sets advisorEnabled to true', () => {
      expect(result.advisorEnabled).toBe(true);
    });

    test('sets pmEnabled to true', () => {
      expect(result.pmEnabled).toBe(true);
    });

    test('parses lead role with single agent and owns list', () => {
      expect(result.teamRoles.lead).toBeDefined();
      expect(result.teamRoles.lead.agents).toEqual(['tech-lead-orchestrator']);
      expect(result.teamRoles.lead.owns).toContain('planning');
      expect(result.teamRoles.lead.owns).toContain('escalation');
      expect(result.teamRoles.lead.owns).toContain('skip-decisions');
    });

    test('parses builder role with multiple agents', () => {
      expect(result.teamRoles.builder).toBeDefined();
      expect(result.teamRoles.builder.agents).toEqual([
        'backend-developer',
        'frontend-developer',
      ]);
      expect(result.teamRoles.builder.owns).toContain('implementation');
    });

    test('parses reviewer role with single agent', () => {
      expect(result.teamRoles.reviewer).toBeDefined();
      expect(result.teamRoles.reviewer.agents).toEqual(['code-reviewer']);
    });

    test('parses qa role with single agent', () => {
      expect(result.teamRoles.qa).toBeDefined();
      expect(result.teamRoles.qa.agents).toEqual(['test-runner']);
    });

    test('parses architect role', () => {
      expect(result.teamRoles.architect).toBeDefined();
      expect(result.teamRoles.architect.agents).toEqual(['architect']);
    });

    test('parses advisor role', () => {
      expect(result.teamRoles.advisor).toBeDefined();
      expect(result.teamRoles.advisor.agents).toEqual(['advisor']);
    });

    test('parses pm role', () => {
      expect(result.teamRoles.pm).toBeDefined();
      expect(result.teamRoles.pm.agents).toEqual(['pm']);
    });

    test('parses documentation role', () => {
      expect(result.teamRoles.documentation).toBeDefined();
      expect(result.teamRoles.documentation.agents).toEqual(['documentation-specialist']);
    });

    test('returns exactly 8 roles', () => {
      expect(Object.keys(result.teamRoles)).toHaveLength(8);
    });
  });

  // -------------------------------------------------------------------------
  // Minimal configuration
  // -------------------------------------------------------------------------
  describe('minimal config (required roles only)', () => {
    let result;

    beforeEach(() => {
      result = parseTeamConfig(MINIMAL_TEAM_CONFIG);
    });

    test('sets teamMode to true', () => {
      expect(result.teamMode).toBe(true);
    });

    test('sets reviewerEnabled to false', () => {
      expect(result.reviewerEnabled).toBe(false);
    });

    test('sets qaEnabled to false', () => {
      expect(result.qaEnabled).toBe(false);
    });

    test('sets advisorEnabled to false', () => {
      expect(result.advisorEnabled).toBe(false);
    });

    test('sets pmEnabled to false', () => {
      expect(result.pmEnabled).toBe(false);
    });

    test('does not include reviewer role', () => {
      expect(result.teamRoles.reviewer).toBeUndefined();
    });

    test('does not include qa role', () => {
      expect(result.teamRoles.qa).toBeUndefined();
    });

    test('does not include advisor role', () => {
      expect(result.teamRoles.advisor).toBeUndefined();
    });

    test('does not include pm role', () => {
      expect(result.teamRoles.pm).toBeUndefined();
    });

    test('returns exactly 4 roles', () => {
      expect(Object.keys(result.teamRoles)).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // Missing team: section
  // -------------------------------------------------------------------------

  describe('missing team: section', () => {
    test('returns teamMode=false for null input', () => {
      const result = parseTeamConfig(null);
      expect(result.teamMode).toBe(false);
    });

    test('returns teamMode=false for undefined input', () => {
      const result = parseTeamConfig(undefined);
      expect(result.teamMode).toBe(false);
    });

    test('returns empty teamRoles for null input', () => {
      const result = parseTeamConfig(null);
      expect(result.teamRoles).toEqual({});
    });

    test('returns reviewerEnabled=false for null input', () => {
      const result = parseTeamConfig(null);
      expect(result.reviewerEnabled).toBe(false);
    });

    test('returns qaEnabled=false for null input', () => {
      const result = parseTeamConfig(null);
      expect(result.qaEnabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------------

  describe('missing required roles', () => {
    test('throws error when lead role is missing', () => {
      const config = {
        roles: [
          { name: 'builder', agent: 'backend-developer' },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
          { name: 'reviewer', agent: 'code-reviewer' },
        ],
      };
      expect(() => parseTeamConfig(config)).toThrow(
        "team.roles must include a 'lead' role"
      );
    });

    test('throws error when builder role is missing', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
          { name: 'reviewer', agent: 'code-reviewer' },
        ],
      };
      expect(() => parseTeamConfig(config)).toThrow(
        "team.roles must include a 'builder' role"
      );
    });

    test('throws error when architect role is missing', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'documentation', agent: 'documentation-specialist' },
          { name: 'reviewer', agent: 'code-reviewer' },
        ],
      };
      expect(() => parseTeamConfig(config)).toThrow(
        "team.roles must include an 'architect' role"
      );
    });

    test('throws error when documentation role is missing', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'architect', agent: 'architect' },
          { name: 'reviewer', agent: 'code-reviewer' },
        ],
      };
      expect(() => parseTeamConfig(config)).toThrow(
        "team.roles must include a 'documentation' role"
      );
    });

    test('throws error when roles array is empty', () => {
      const config = { roles: [] };
      expect(() => parseTeamConfig(config)).toThrow(
        "team.roles must include a 'lead' role"
      );
    });

    test('throws error when roles key is absent', () => {
      const config = {};
      expect(() => parseTeamConfig(config)).toThrow(
        "team.roles must include a 'lead' role"
      );
    });
  });

  // -------------------------------------------------------------------------
  // agent: (singular) vs agents: (plural) normalisation
  // -------------------------------------------------------------------------

  describe('agent normalization (singular -> agents array)', () => {
    test('converts singular agent: to agents: [agent]', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.teamRoles.lead.agents).toEqual(['tech-lead-orchestrator']);
      expect(result.teamRoles.builder.agents).toEqual(['backend-developer']);
    });

    test('keeps plural agents: list as-is', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          {
            name: 'builder',
            agents: ['backend-developer', 'frontend-developer'],
          },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.teamRoles.builder.agents).toEqual([
        'backend-developer',
        'frontend-developer',
      ]);
    });

    test('agent: single agent results in array of length 1', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
          { name: 'reviewer', agent: 'code-reviewer' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.teamRoles.reviewer.agents).toHaveLength(1);
    });

    test('agents: multiple agents results in array of correct length', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          {
            name: 'builder',
            agents: ['backend-developer', 'frontend-developer', 'infrastructure-developer'],
          },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.teamRoles.builder.agents).toHaveLength(3);
    });

    test('role with neither agent nor agents defaults to empty array', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder' }, // no agent or agents key
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.teamRoles.builder.agents).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // owns: field
  // -------------------------------------------------------------------------

  describe('owns field handling', () => {
    test('owns list is preserved as-is', () => {
      const config = {
        roles: [
          {
            name: 'lead',
            agent: 'tech-lead-orchestrator',
            owns: ['planning', 'escalation'],
          },
          { name: 'builder', agent: 'backend-developer', owns: ['implementation'] },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.teamRoles.lead.owns).toEqual(['planning', 'escalation']);
      expect(result.teamRoles.builder.owns).toEqual(['implementation']);
    });

    test('missing owns field defaults to empty array', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.teamRoles.lead.owns).toEqual([]);
      expect(result.teamRoles.builder.owns).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // reviewer + qa optional combinations
  // -------------------------------------------------------------------------

  describe('optional role presence', () => {
    test('reviewer only (no qa/advisor/pm) sets reviewerEnabled=true, qaEnabled=false', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
          { name: 'reviewer', agent: 'code-reviewer' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.reviewerEnabled).toBe(true);
      expect(result.qaEnabled).toBe(false);
      expect(result.advisorEnabled).toBe(false);
      expect(result.pmEnabled).toBe(false);
    });

    test('qa only (no reviewer/advisor/pm) sets reviewerEnabled=false, qaEnabled=true', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
          { name: 'qa', agent: 'test-runner' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.reviewerEnabled).toBe(false);
      expect(result.qaEnabled).toBe(true);
      expect(result.advisorEnabled).toBe(false);
      expect(result.pmEnabled).toBe(false);
    });

    test('advisor only sets advisorEnabled=true', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
          { name: 'advisor', agent: 'advisor' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.advisorEnabled).toBe(true);
      expect(result.pmEnabled).toBe(false);
    });

    test('pm only sets pmEnabled=true', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
          { name: 'pm', agent: 'pm' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.advisorEnabled).toBe(false);
      expect(result.pmEnabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // agent: vs agents: mutual exclusivity
  // -------------------------------------------------------------------------

  describe('agent: vs agents: mutual exclusivity', () => {
    test('when both agent: and agents: on same role, agents: takes precedence', () => {
      const config = parseTeamConfig({
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer', agents: ['backend-developer', 'frontend-developer'] },
          { name: 'architect', agent: 'architect' },
          { name: 'documentation', agent: 'documentation-specialist' },
        ],
      });
      expect(config.teamRoles.builder.agents).toEqual(['backend-developer', 'frontend-developer']);
    });
  });
});
