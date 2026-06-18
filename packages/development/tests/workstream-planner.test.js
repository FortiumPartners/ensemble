'use strict';

const { buildWorkstreamPlan, validateWorkstream, deriveWorkstreamSlug } = require('../lib/workstream-planner');

function parsed(over = {}) {
  return {
    title: 'TRD Demo',
    summary: 'Demo',
    prdReference: 'docs/PRD/demo.md',
    designReadinessScore: 4.5,
    status: 'Draft',
    prFormat: true,
    phases: [{ n: 1, title: 'PR 1', shippableState: 'Users can do demo work.', taskIds: ['TRD-001'] }],
    tasksById: {
      'TRD-001': {
        id: 'TRD-001', phaseN: 1, description: 'Build demo', isTest: false,
        hourEstimate: 1, satisfies: ['REQ-001'], verifies: null, validatesAcs: ['AC-001-1'],
        dependsOn: [], targetFiles: ['demo.js'], actions: ['Implement'], implementationAc: ['Passes'],
        testAc: [], nestedSubitems: [], testSubitems: [], proofOfRequirement: null,
      },
    },
    warnings: [],
    ...over,
  };
}

describe('workstream-planner', () => {
  test('validates all TRDs before side effects', () => {
    const result = validateWorkstream([
      { trdPath: 'docs/TRD/TRD-2026-001-alpha.md', parsed: parsed() },
      { trdPath: 'docs/TRD/TRD-2026-002-beta.md', parsed: parsed({ designReadinessScore: null }) },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].reason).toMatch(/Missing design_readiness_score/);
  });

  test('builds release train, TRD epics, and scaffold plans', () => {
    const result = buildWorkstreamPlan([
      { trdPath: 'docs/TRD/TRD-2026-001-alpha.md', parsed: parsed({ title: 'Alpha' }) },
      { trdPath: 'docs/TRD/TRD-2026-002-beta.md', parsed: parsed({ title: 'Beta' }) },
    ], { stackedPrs: true, workstreamSlug: 'alpha-beta' });
    expect(result.ok).toBe(true);
    expect(result.releaseTrain.titlePrefix).toBe('[release-train:alpha-beta]');
    expect(result.trdEpics).toHaveLength(2);
    expect(result.scaffoldPlans[0].plan.tasks[0].titlePrefix).toContain(':task:TRD-001');
    expect(result.deps.map((d) => d.type)).toContain('trd-epic-blocks-release-train');
  });

  test('derives common workstream slug', () => {
    expect(deriveWorkstreamSlug(['docs/TRD/TRD-2026-001-alpha.md', 'docs/TRD/TRD-2026-001-beta.md'])).toBe('trd-2026-001');
  });
});
