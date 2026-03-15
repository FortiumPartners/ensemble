/**
 * TRD-011: Unit tests for the team YAML parser
 *
 * The parser processes the `team:` section from a command YAML file and
 * returns a normalized team configuration object used to drive TEAM_MODE
 * execution in the implement-trd-beads workflow.
 */

'use strict';

// ---------------------------------------------------------------------------
// Parser implementation
// ---------------------------------------------------------------------------

/**
 * Parses the `team:` section of a command YAML (already loaded as a JS object)
 * and returns a normalized team configuration.
 *
 * Expected input shape (from YAML):
 * ```yaml
 * team:
 *   roles:
 *     - name: lead
 *       agent: tech-lead-orchestrator   # singular form
 *       owns: [planning, escalation]
 *     - name: builder
 *       agents: [backend-developer, frontend-developer]  # plural form
 *       owns: [implementation]
 *     - name: reviewer
 *       agent: code-reviewer
 *     - name: qa
 *       agent: qa-orchestrator
 * ```
 *
 * @param {Object|undefined|null} yamlTeamSection - The `team:` object from parsed YAML
 * @returns {{ teamMode: boolean, teamRoles: Object, reviewerEnabled: boolean, qaEnabled: boolean }}
 * @throws {Error} if required roles (lead, builder) are missing
 */
function parseTeamConfig(yamlTeamSection) {
  // No team: section — single-agent execution mode
  if (!yamlTeamSection) {
    return {
      teamMode: false,
      teamRoles: {},
      reviewerEnabled: false,
      qaEnabled: false,
    };
  }

  const roles = yamlTeamSection.roles || [];
  const teamRoles = {};

  for (const role of roles) {
    // Support both singular `agent:` and plural `agents:` forms
    const agents =
      role.agents ||
      (role.agent ? [role.agent] : []);

    teamRoles[role.name] = {
      agents,
      owns: role.owns || [],
    };
  }

  // Required role validation
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
// Test fixtures
// ---------------------------------------------------------------------------

/** Full team config: lead + builder + reviewer + qa */
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
      agent: 'qa-orchestrator',
      owns: ['quality-assurance'],
    },
  ],
};

/** Minimal team config: lead + builder only (no reviewer, no qa) */
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
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Team YAML Parser (parseTeamConfig)', () => {
  // -------------------------------------------------------------------------
  // Full configuration
  // -------------------------------------------------------------------------

  describe('full config (lead + builder + reviewer + qa)', () => {
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
      expect(result.teamRoles.qa.agents).toEqual(['qa-orchestrator']);
    });

    test('returns exactly 4 roles', () => {
      expect(Object.keys(result.teamRoles)).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // Minimal configuration
  // -------------------------------------------------------------------------

  describe('minimal config (lead + builder only)', () => {
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

    test('does not include reviewer role', () => {
      expect(result.teamRoles.reviewer).toBeUndefined();
    });

    test('does not include qa role', () => {
      expect(result.teamRoles.qa).toBeUndefined();
    });

    test('returns exactly 2 roles', () => {
      expect(Object.keys(result.teamRoles)).toHaveLength(2);
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
          { name: 'reviewer', agent: 'code-reviewer' },
        ],
      };
      expect(() => parseTeamConfig(config)).toThrow(
        "team.roles must include a 'builder' role"
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
    test('reviewer only (no qa) sets reviewerEnabled=true, qaEnabled=false', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'reviewer', agent: 'code-reviewer' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.reviewerEnabled).toBe(true);
      expect(result.qaEnabled).toBe(false);
    });

    test('qa only (no reviewer) sets reviewerEnabled=false, qaEnabled=true', () => {
      const config = {
        roles: [
          { name: 'lead', agent: 'tech-lead-orchestrator' },
          { name: 'builder', agent: 'backend-developer' },
          { name: 'qa', agent: 'qa-orchestrator' },
        ],
      };
      const result = parseTeamConfig(config);
      expect(result.reviewerEnabled).toBe(false);
      expect(result.qaEnabled).toBe(true);
    });
  });
});
