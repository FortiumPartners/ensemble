/**
 * Unit tests for TRD-007 / TRD-007-TEST (REQ-009): de-advertisement and
 * discoverability convergence for `/ensemble:new-feature` behind the
 * canonical front door `/ensemble:feature`.
 *
 * `ensemble:new-feature` remains fully functional -- it's `ensemble:feature`'s
 * own internal implementation (see feature.yaml's mission summary) -- but is
 * no longer advertised as a top-level entry point in product documentation,
 * and a natural-language "start a new feature" request should converge on
 * the same canonical name both commands already agree on.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadYaml(relPath) {
  return yaml.load(fs.readFileSync(path.join(repoRoot, relPath), 'utf-8'));
}

function actionsText(step) {
  return (step.actions || []).join('\n');
}

describe('Scenario: direct invocation of ensemble-new-feature still works and converges identically', () => {
  const newFeatureYaml = loadYaml('packages/development/commands/new-feature.yaml');

  test('its parameters (idea/path/status/abandon, plus the non-interactive foreman flag) and fixed 10-stage constraints are unchanged -- same stage machine', () => {
    const paramNames = newFeatureYaml.parameters.map((p) => p.name);
    expect(paramNames).toEqual(['idea', 'path', 'status', 'abandon', 'foreman']);
    expect(newFeatureYaml.constraints.join('\n')).toMatch(
      /prd_create -> *\s*prd_refine -> trd_create -> trd_refine -> beads_plan ->\s*implementation_approval -> implementation -> pr_approval -> pr_create ->\s*done/,
    );
  });

  test('the de-advertisement pointer explicitly states zero behavior change for direct invocation', () => {
    const step1 = newFeatureYaml.workflow.phases[0].steps.find((s) => s.order === 1);
    const text = actionsText(step1);
    expect(text).toMatch(/De-advertisement pointer \(REQ-009\)/);
    expect(text).toContain(
      'Direct invocation of this command still works and behaves identically -- same createRun/resolveByArtifact/mutate calls, same run record, same stage machine, zero behavior change.',
    );
  });

  test('the only addition is one informational pointer line -- it never gates, delays, or alters any step\'s own decision', () => {
    const step1 = newFeatureYaml.workflow.phases[0].steps.find((s) => s.order === 1);
    const text = actionsText(step1);
    expect(text).toContain(
      "'Driven directly via /ensemble:new-feature; /ensemble:feature is the canonical front door for this workflow.'",
    );
    expect(text).toContain('This line never gates, delays, or alters any step\'s own decision.');
  });
});

describe('Scenario: skill/command convergence -- "start a new feature" names the same canonical workflow', () => {
  const featureYaml = loadYaml('packages/development/commands/feature.yaml');
  const newFeatureYaml = loadYaml('packages/development/commands/new-feature.yaml');

  test('feature.yaml\'s own mission names ensemble:feature as the single canonical front door for the feature lifecycle', () => {
    expect(featureYaml.mission.summary).toMatch(/Single canonical front door for the feature lifecycle/);
  });

  test('feature.yaml\'s "new" keyword and new-feature.yaml\'s own idea parameter describe the identical starting workflow (idea -> PRD -> TRD -> beads -> implementation)', () => {
    const newKeyword = featureYaml.dispatch.subcommands.find((s) => s.keyword === 'new');
    expect(newKeyword.description).toMatch(/Start a new feature run from an idea/);
    expect(newFeatureYaml.metadata.description).toMatch(
      /Resumable, checkpointed workflow from an idea through PRD, TRD, bead\s*planning, and approved implementation/,
    );
  });

  test('new-feature.yaml\'s own pointer names /ensemble:feature as the canonical front door for the same workflow it implements', () => {
    const step1 = newFeatureYaml.workflow.phases[0].steps.find((s) => s.order === 1);
    expect(actionsText(step1)).toContain(
      'this workflow is the internal implementation behind the canonical front door `/ensemble:feature`',
    );
  });
});
