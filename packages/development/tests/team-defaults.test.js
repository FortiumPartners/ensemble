'use strict';

const { resolveDefaultTeamRoles } = require('../lib/team-defaults');

describe('resolveDefaultTeamRoles', () => {
  test('simple tier still includes the full 8-role roster and documentation', () => {
    const roles = resolveDefaultTeamRoles({
      complexity: 'simple',
      domains: ['backend'],
    });

    expect(Object.keys(roles)).toEqual([
      'lead',
      'builder',
      'architect',
      'documentation',
      'reviewer',
      'qa',
      'advisor',
      'pm',
    ]);
    expect(roles.documentation.agents).toEqual(['documentation-specialist']);
    expect(roles.builder.agents).toEqual(['backend-developer']);
  });

  test('medium tier still includes the full 8-role roster and varies builder selection', () => {
    const roles = resolveDefaultTeamRoles({
      complexity: 'medium',
      domains: ['backend', 'frontend'],
    });

    expect(Object.keys(roles)).toHaveLength(8);
    expect(roles.reviewer.agents).toEqual(['code-reviewer']);
    expect(roles.qa.agents).toEqual(['test-runner']);
    expect(roles.advisor.agents).toEqual(['advisor']);
    expect(roles.pm.agents).toEqual(['product-management-orchestrator']);
    expect(roles.builder.agents).toEqual(['backend-developer', 'frontend-developer']);
  });

  test('complex tier still includes the full 8-role roster', () => {
    const roles = resolveDefaultTeamRoles({
      complexity: 'complex',
      domains: ['backend', 'frontend', 'infrastructure'],
    });

    expect(Object.keys(roles)).toHaveLength(8);
    expect(roles.documentation.agents).toEqual(['documentation-specialist']);
    expect(roles.advisor.agents).toEqual(['advisor']);
    expect(roles.pm.agents).toEqual(['product-management-orchestrator']);
    expect(roles.builder.agents).toEqual([
      'backend-developer',
      'frontend-developer',
      'infrastructure-developer',
    ]);
  });

  test('returns the same shape regardless of caller command', () => {
    const beadsRoles = resolveDefaultTeamRoles({
      complexity: 'complex',
      domains: ['backend', 'frontend'],
      caller: 'implement-trd-tasks',
    });

    const otherCallerRoles = resolveDefaultTeamRoles({
      complexity: 'complex',
      domains: ['backend', 'frontend'],
      caller: 'beads-build',
    });

    expect(otherCallerRoles).toEqual(beadsRoles);
  });
});
