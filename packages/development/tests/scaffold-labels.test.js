'use strict';

/**
 * br-0wx: scaffold-planner created beads with NO labels, so there was nothing for
 * `bv --robot-plan --label <L>` to scope by. Every bead the planner emits now carries
 * its TRD's slug as a label (the same string inside every `[trd:<slug>...]` title; the
 * frontmatter Label is display-only and never a reference key).
 */

const { buildScaffoldPlan } = require('../lib/scaffold-planner');
const { buildWorkstreamPlan } = require('../lib/workstream-planner');

const SLUG = 'trd-2026-aaaaaaaa-demo';
const OPTS = { trdSlug: SLUG, trdFilePath: 'docs/TRD/demo.md', prdFilePath: 'docs/PRD/demo.md' };

function makeTask(over) {
  return {
    id: 'TRD-001',
    phaseN: 1,
    description: 'Do the thing',
    isTest: false,
    hourEstimate: null,
    satisfies: ['REQ-001'],
    verifies: null,
    validatesAcs: [],
    dependsOn: [],
    targetFiles: [],
    actions: [],
    implementationAc: [],
    testAc: [],
    nestedSubitems: [],
    testSubitems: ['Write a unit test'],
    proofOfRequirement: null,
    ...over,
  };
}

const parsed = () => ({
  title: 'Demo',
  summary: 'A demo.',
  prdReference: 'docs/PRD/demo.md',
  designReadinessScore: 4.5,
  status: 'Draft',
  prFormat: true,
  phases: [{ n: 1, title: 'Foundation', shippableState: 'Users can use it.', taskIds: ['TRD-001'] }],
  tasksById: { 'TRD-001': makeTask({}) },
  warnings: [],
});

describe('scaffold plan labels', () => {
  const plan = buildScaffoldPlan(parsed(), OPTS);
  const beads = () => [plan.epic, ...plan.stories, ...plan.tasks, ...plan.synthesizedTests];

  test('the plan names its label (the TRD slug)', () => {
    expect(plan.label).toBe(SLUG);
  });

  test('every epic, story, task and synthesized-test bead carries exactly that label', () => {
    expect(beads()).toHaveLength(1 + 1 + 1 + 1); // epic, story, task, synthesized test
    for (const b of beads()) expect(b.labels).toEqual([SLUG]);
  });

  test('labels are safe for br: lowercase letters, digits and hyphens', () => {
    expect(plan.label).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('workstream plan labels', () => {
  const item = (slugPath) => ({ trdPath: slugPath, parsed: parsed() });
  const result = buildWorkstreamPlan(
    [item('docs/TRD/TRD-2026-001-alpha.md'), item('docs/TRD/TRD-2026-002-beta.md')],
    { stackedPrs: true, workstreamSlug: 'alpha-beta' }
  );

  test('the release train has its own label', () => {
    expect(result.releaseTrain.labels).toEqual(['release-train-alpha-beta']);
  });

  test('each TRD epic is labelled with its TRD slug', () => {
    expect(result.trdEpics.map((e) => e.labels)).toEqual([
      ['trd-2026-001-alpha'],
      ['trd-2026-002-beta'],
    ]);
  });

  test('each TRD scaffold plan labels its beads with that TRD slug', () => {
    for (const { slug, plan } of result.scaffoldPlans) {
      expect(plan.label).toBe(slug);
      expect(plan.tasks.every((t) => t.labels.length === 1 && t.labels[0] === slug)).toBe(true);
    }
  });
});
