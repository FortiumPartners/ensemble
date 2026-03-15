/**
 * Tests for TRD team config section parsing and backward compatibility.
 *
 * Covers TRD-040 (parse ## Team Configuration from TRD markdown) and
 * TRD-041 (precedence logic: TRD > command YAML > none, backward compat).
 *
 * Also validates structural properties of implement-trd-beads.yaml itself.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// js-yaml is a devDependency of packages/development
let yaml;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null; // tests that need yaml will skip gracefully
}

// ---------------------------------------------------------------------------
// Helper functions — mirror the YAML workflow logic (Preflight step 8)
// ---------------------------------------------------------------------------

/**
 * Extract the raw YAML string from the ## Team Configuration block in a TRD.
 * Returns null if the heading is absent or no fenced yaml block follows it.
 */
function parseTeamConfigFromTrd(trdContent) {
  const headingMatch = trdContent.match(/^## Team Configuration\s*$/m);
  if (!headingMatch) return null;

  const afterHeading = trdContent.slice(headingMatch.index + headingMatch[0].length);
  const yamlMatch = afterHeading.match(/```yaml\n([\s\S]*?)```/);
  if (!yamlMatch) return null;

  return yamlMatch[1];
}

/**
 * Validate a parsed team configuration object.
 * Returns an array of error strings (empty = valid).
 *
 * Validation rules from implement-trd-beads.yaml Preflight step 8:
 *   - team.roles array is required
 *   - lead and builder roles MUST be present
 *   - agent: and agents: are mutually exclusive per role
 *   - owns: list MUST be non-empty for each role
 */
function validateTeamConfig(teamConfig) {
  const errors = [];

  if (!teamConfig || !teamConfig.roles) {
    errors.push('team.roles array is required');
    return errors;
  }

  const hasLead    = teamConfig.roles.some(r => r.name === 'lead');
  const hasBuilder = teamConfig.roles.some(r => r.name === 'builder');

  if (!hasLead)    errors.push('team.roles must include a lead role');
  if (!hasBuilder) errors.push('team.roles must include a builder role');

  for (const role of teamConfig.roles) {
    if (role.agent && role.agents) {
      errors.push(`Role ${role.name}: agent: and agents: are mutually exclusive`);
    }
    if (!role.owns || role.owns.length === 0) {
      errors.push(`Role ${role.name}: owns: is required and must be non-empty`);
    }
  }

  return errors;
}

/**
 * Validate agent names against a known-agents registry.
 * Returns an array of error strings (empty = valid).
 */
function validateAgentNames(teamConfig, knownAgents) {
  const errors = [];
  if (!teamConfig || !teamConfig.roles) return errors;

  const knownSet = new Set(knownAgents);
  for (const role of teamConfig.roles) {
    const agentList = role.agents ? role.agents : (role.agent ? [role.agent] : []);
    for (const agentName of agentList) {
      if (!knownSet.has(agentName)) {
        errors.push(`Agent '${agentName}' in role '${role.name}' not found in ensemble registry`);
      }
    }
  }
  return errors;
}

/**
 * Resolve which source provides the team configuration.
 * Precedence: TRD section > command YAML team: key > none.
 */
function resolveTeamConfigSource(trdContent, commandYamlHasTeam) {
  const trdConfig = parseTeamConfigFromTrd(trdContent);
  if (trdConfig) return { source: 'trd', config: trdConfig };
  if (commandYamlHasTeam) return { source: 'yaml', config: 'command_yaml_team' };
  return { source: 'none', config: null };
}

// ---------------------------------------------------------------------------
// TRD fixtures
// ---------------------------------------------------------------------------

const VALID_TRD_WITH_TEAM_CONFIG = `
# TRD: Example Feature

## Summary
Some description.

## Master Task List
- [ ] **TRD-001**: Implement backend API endpoint (3h)
- [ ] **TRD-002**: Write unit tests (2h)

## Team Configuration

\`\`\`yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      owns:
        - task-selection
        - architecture-review
        - final-approval
    - name: builder
      agents:
        - backend-developer
      owns:
        - implementation
    - name: reviewer
      agent: code-reviewer
      owns:
        - code-review
    - name: qa
      agent: qa-orchestrator
      owns:
        - quality-gate
        - acceptance-criteria
\`\`\`
`;

const TRD_WITHOUT_TEAM_CONFIG = `
# TRD: Simple Feature

## Summary
Some description.

## Master Task List
- [ ] **TRD-001**: Implement basic endpoint (2h)
- [ ] **TRD-002**: Add tests (2h)
`;

const TRD_WITH_MISSING_LEAD = `
# TRD: Bad Config

## Team Configuration

\`\`\`yaml
team:
  roles:
    - name: builder
      agent: backend-developer
      owns:
        - implementation
\`\`\`
`;

const TRD_WITH_MISSING_OWNS = `
# TRD: Incomplete Config

## Team Configuration

\`\`\`yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      owns:
        - task-selection
    - name: builder
      agent: backend-developer
\`\`\`
`;

const TRD_WITH_MUTUAL_EXCLUSIVE_AGENTS = `
# TRD: Schema Violation

## Team Configuration

\`\`\`yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      agents:
        - backend-developer
      owns:
        - task-selection
    - name: builder
      agent: backend-developer
      owns:
        - implementation
\`\`\`
`;

const TRD_WITH_NONEXISTENT_AGENT = `
# TRD: Bad Agent

## Team Configuration

\`\`\`yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      owns:
        - task-selection
    - name: builder
      agent: nonexistent-fantasy-agent
      owns:
        - implementation
\`\`\`
`;

// ---------------------------------------------------------------------------
// TRD-040: Parsing ## Team Configuration from TRD markdown
// ---------------------------------------------------------------------------

describe('TRD-040: parseTeamConfigFromTrd', () => {
  it('returns YAML string when valid ## Team Configuration section found', () => {
    const result = parseTeamConfigFromTrd(VALID_TRD_WITH_TEAM_CONFIG);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result).toContain('team:');
    expect(result).toContain('roles:');
  });

  it('returns null when ## Team Configuration is absent', () => {
    expect(parseTeamConfigFromTrd(TRD_WITHOUT_TEAM_CONFIG)).toBeNull();
  });

  it('returned YAML parses successfully with js-yaml', () => {
    if (!yaml) return; // skip if js-yaml unavailable
    const raw = parseTeamConfigFromTrd(VALID_TRD_WITH_TEAM_CONFIG);
    expect(() => yaml.load(raw)).not.toThrow();
    const parsed = yaml.load(raw);
    expect(parsed).toHaveProperty('team');
    expect(parsed.team).toHaveProperty('roles');
    expect(Array.isArray(parsed.team.roles)).toBe(true);
  });

  it('parsed team config has 4 roles (lead, builder, reviewer, qa)', () => {
    if (!yaml) return;
    const raw = parseTeamConfigFromTrd(VALID_TRD_WITH_TEAM_CONFIG);
    const parsed = yaml.load(raw);
    const roleNames = parsed.team.roles.map(r => r.name);
    expect(roleNames).toContain('lead');
    expect(roleNames).toContain('builder');
    expect(roleNames).toContain('reviewer');
    expect(roleNames).toContain('qa');
  });

  it('sets TEAM_MODE=true when ## Team Configuration is present', () => {
    const raw = parseTeamConfigFromTrd(VALID_TRD_WITH_TEAM_CONFIG);
    const TEAM_MODE = raw !== null;
    expect(TEAM_MODE).toBe(true);
  });

  it('sets TEAM_MODE=false (single-agent) when section is absent', () => {
    const raw = parseTeamConfigFromTrd(TRD_WITHOUT_TEAM_CONFIG);
    const TEAM_MODE = raw !== null;
    expect(TEAM_MODE).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TRD-040: validateTeamConfig
// ---------------------------------------------------------------------------

describe('TRD-040: validateTeamConfig', () => {
  it('returns no errors for a valid full team config', () => {
    if (!yaml) return;
    const raw = parseTeamConfigFromTrd(VALID_TRD_WITH_TEAM_CONFIG);
    const parsed = yaml.load(raw);
    expect(validateTeamConfig(parsed.team)).toHaveLength(0);
  });

  it('returns error when lead role is missing', () => {
    if (!yaml) return;
    const raw = parseTeamConfigFromTrd(TRD_WITH_MISSING_LEAD);
    const parsed = yaml.load(raw);
    const errors = validateTeamConfig(parsed.team);
    expect(errors.some(e => e.includes('lead role'))).toBe(true);
  });

  it('returns error when builder role is missing', () => {
    const config = { roles: [{ name: 'lead', agent: 'tech-lead-orchestrator', owns: ['task-selection'] }] };
    const errors = validateTeamConfig(config);
    expect(errors.some(e => e.includes('builder role'))).toBe(true);
  });

  it('returns error when both agent: and agents: are set on same role', () => {
    if (!yaml) return;
    const raw = parseTeamConfigFromTrd(TRD_WITH_MUTUAL_EXCLUSIVE_AGENTS);
    const parsed = yaml.load(raw);
    const errors = validateTeamConfig(parsed.team);
    expect(errors.some(e => e.includes('mutually exclusive'))).toBe(true);
  });

  it('returns error when owns: is missing on a role', () => {
    if (!yaml) return;
    const raw = parseTeamConfigFromTrd(TRD_WITH_MISSING_OWNS);
    const parsed = yaml.load(raw);
    const errors = validateTeamConfig(parsed.team);
    expect(errors.some(e => e.includes('owns:') && e.includes('builder'))).toBe(true);
  });

  it('returns error when roles array is missing entirely', () => {
    const errors = validateTeamConfig({});
    expect(errors.some(e => e.includes('team.roles array'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TRD-040: Agent registry validation
// ---------------------------------------------------------------------------

describe('TRD-040: Agent registry validation', () => {
  const KNOWN_AGENTS = [
    'tech-lead-orchestrator',
    'backend-developer',
    'frontend-developer',
    'code-reviewer',
    'qa-orchestrator',
    'test-runner',
    'infrastructure-developer',
  ];

  it('passes when all referenced agents exist in registry', () => {
    if (!yaml) return;
    const raw = parseTeamConfigFromTrd(VALID_TRD_WITH_TEAM_CONFIG);
    const parsed = yaml.load(raw);
    const errors = validateAgentNames(parsed.team, KNOWN_AGENTS);
    expect(errors).toHaveLength(0);
  });

  it('returns error when an agent is not in the registry', () => {
    if (!yaml) return;
    const raw = parseTeamConfigFromTrd(TRD_WITH_NONEXISTENT_AGENT);
    const parsed = yaml.load(raw);
    const errors = validateAgentNames(parsed.team, KNOWN_AGENTS);
    expect(errors.some(e => e.includes('nonexistent-fantasy-agent'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TRD-041: Precedence and backward compatibility
// ---------------------------------------------------------------------------

describe('TRD-041: Team config source precedence', () => {
  it('TRD ## Team Configuration takes priority over command YAML', () => {
    const result = resolveTeamConfigSource(VALID_TRD_WITH_TEAM_CONFIG, true);
    expect(result.source).toBe('trd');
  });

  it('command YAML is used when TRD has no team config section', () => {
    const result = resolveTeamConfigSource(TRD_WITHOUT_TEAM_CONFIG, true);
    expect(result.source).toBe('yaml');
  });

  it('source is none when both TRD and command YAML lack team config', () => {
    const result = resolveTeamConfigSource(TRD_WITHOUT_TEAM_CONFIG, false);
    expect(result.source).toBe('none');
    expect(result.config).toBeNull();
  });

  it('TRD source still wins even when commandYamlHasTeam=false', () => {
    const result = resolveTeamConfigSource(VALID_TRD_WITH_TEAM_CONFIG, false);
    expect(result.source).toBe('trd');
    expect(result.config).not.toBeNull();
  });
});

describe('TRD-041: Backward compatibility with existing TRDs', () => {
  it('existing TRD without ## Team Configuration works (TEAM_MODE=false)', () => {
    const raw = parseTeamConfigFromTrd(TRD_WITHOUT_TEAM_CONFIG);
    expect(raw).toBeNull();
    // Simulate: if trdConfig is null and no command YAML team: → TEAM_MODE=false
    const { source } = resolveTeamConfigSource(TRD_WITHOUT_TEAM_CONFIG, false);
    expect(source).toBe('none');
  });

  it('TRD without team config section does not throw when parsed', () => {
    expect(() => parseTeamConfigFromTrd(TRD_WITHOUT_TEAM_CONFIG)).not.toThrow();
  });

  it('minimal TRD content (just title and tasks) is backward-compatible', () => {
    const minimalTrd = '# My TRD\n\n- [ ] **TRD-001**: Do the thing (2h)\n';
    expect(parseTeamConfigFromTrd(minimalTrd)).toBeNull();
    const { source } = resolveTeamConfigSource(minimalTrd, false);
    expect(source).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// TRD-041: implement-trd-beads.yaml structural validation
// ---------------------------------------------------------------------------

describe('TRD-041: implement-trd-beads.yaml structure', () => {
  const YAML_PATH = path.resolve(
    __dirname,
    '../commands/implement-trd-beads.yaml'
  );

  let rawContent;
  beforeAll(() => {
    rawContent = fs.readFileSync(YAML_PATH, 'utf8');
  });

  it('file exists and is non-empty', () => {
    expect(rawContent.length).toBeGreaterThan(0);
  });

  it('version is 2.4.0', () => {
    expect(rawContent).toMatch(/version:\s*['"]?2\.4\.0['"]?/);
  });

  it('preflight step 8 contains TRD-first parsing logic', () => {
    expect(rawContent).toMatch(/Team Configuration Detection/);
    expect(rawContent).toMatch(/TRD-FIRST PARSING/);
    expect(rawContent).toMatch(/## Team Configuration/);
    expect(rawContent).toMatch(/TEAM_CONFIG_SOURCE/);
  });

  it('preflight step 9 (Marketplace Preflight Check) exists', () => {
    expect(rawContent).toMatch(/Marketplace Preflight Check/);
    expect(rawContent).toMatch(/order:\s*9/);
  });

  it('defines TEAM_MODE variable logic', () => {
    expect(rawContent).toMatch(/TEAM_MODE/);
    expect(rawContent).toMatch(/TEAM_CONFIG_SOURCE/);
  });

  it('documents precedence: TRD section > command YAML > none', () => {
    // The precedence comment should appear in the step description
    expect(rawContent).toMatch(/precedence order/i);
  });

  it('parses as valid YAML (non-commented top-level keys)', () => {
    if (!yaml) return;
    // The file uses comments extensively; we just verify it is parseable
    expect(() => yaml.load(rawContent)).not.toThrow();
  });

  it('metadata.name is ensemble:implement-trd-beads', () => {
    if (!yaml) return;
    const doc = yaml.load(rawContent);
    expect(doc.metadata.name).toBe('ensemble:implement-trd-beads');
  });
});
