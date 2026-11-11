'use strict';

/**
 * The TRD commands must not hard-code Reqnroll/BDD. create-trd and implement-trd-beads resolve
 * one BDD_MODE through `trd-cli resolve-bdd` (lib/bdd-mode.js); every mention of Reqnroll in them
 * has to sit behind that mode. The other TRD commands never mention it.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { readCommandProse } = require('../../../scripts/lib/skill-backed-command');
const { readDevelopmentSkill } = require('./helpers/skill-workflow');
const { parseWorkflow } = require('../../product/tests/helpers/skill-prompt');

// Every command named here is skill-backed: its YAML is a manifest (metadata + skill) and its prompt
// is its skill, SKILL.md plus the phase files under references/. `read` is the whole prompt (the
// manifest, then the skill) where it used to be the YAML text; `load` is the manifest's metadata with
// the phases, steps and actions read back out of the skill's phase files.
const COMMANDS = path.join(__dirname, '..', 'commands');
const manifestText = (name) => fs.readFileSync(path.join(COMMANDS, name), 'utf8');
const manifestOf = (name) => yaml.load(manifestText(name));
const read = (name) => readCommandProse(path.join(COMMANDS, name), manifestOf(name), manifestText(name));
const load = (name) => {
  const manifest = manifestOf(name);
  return { metadata: manifest.metadata, workflow: { phases: parseWorkflow(readDevelopmentSkill(manifest.skill)) } };
};

// A line that names Reqnroll must also name the mode, the resolver, or the env var that governs it.
const GATE = /BDD_MODE|resolve-bdd|ENSEMBLE_BDD/;
const ungatedReqnrollLines = (text) => text.split('\n').filter((l) => /reqnroll/i.test(l) && !GATE.test(l));

const step = (doc, phaseName, title) => doc.workflow.phases.find((p) => p.name === phaseName).steps.find((s) => s.title === title);
const actions = (doc, phaseName, title) => step(doc, phaseName, title).actions.map(String).join('\n');
const stepIndex = (doc, phaseName, title) => doc.workflow.phases.find((p) => p.name === phaseName).steps.findIndex((s) => s.title === title);

describe('Reqnroll is gated on BDD_MODE in the commands that mention it', () => {
  test.each(['create-trd.yaml', 'implement-trd-beads.yaml'])('every Reqnroll mention in %s is tied to BDD_MODE', (file) => {
    expect(ungatedReqnrollLines(read(file))).toEqual([]);
  });

  test.each([
    'refine-trd.yaml',
    'trd.yaml',
    'validate-requirements.yaml',
    'analyze-requirements.yaml',
    'verify-requirements.yaml',
    'requirement-status.yaml',
    'trd-dependency-graph.yaml',
    'beads-build.yaml',
    'implement-bead.yaml',
  ])('%s does not mention Reqnroll at all', (file) => {
    expect(read(file)).not.toMatch(/reqnroll/i);
  });

  test('MUTATION PROOF: the gate check fails on the unconditional wording this change removed', () => {
    // The 7.0.0 wording, and the real files with every gate token stripped, must both be caught.
    const unconditional = '- "implement-trd-beads routes any task whose id matches `-TEST` through the reqnroll BDD path."';
    expect(ungatedReqnrollLines(unconditional)).toHaveLength(1);
    for (const file of ['create-trd.yaml', 'implement-trd-beads.yaml']) {
      const original = read(file);
      const mentions = original.split('\n').filter((l) => /reqnroll/i.test(l)).length;
      expect(mentions).toBeGreaterThan(0);
      const stripped = original.replace(new RegExp(GATE.source, 'g'), 'x');
      expect(ungatedReqnrollLines(stripped)).toHaveLength(mentions);
    }
  });
});

describe('create-trd resolves the test approach once, before it needs it', () => {
  const doc = load('create-trd.yaml');
  const P1 = 'PRD Ingestion and Validation';

  test('advertises --bdd and --no-bdd in the argument hint', () => {
    expect(doc.metadata.argument_hint).toContain('[--bdd | --no-bdd]');
  });

  test('Resolve Test Approach runs trd-cli resolve-bdd, HALTs on failure, and precedes Requirements Validation', () => {
    const text = actions(doc, P1, 'Resolve Test Approach');
    expect(text).toContain('node "$TRD_CLI" resolve-bdd');
    expect(text).toContain('HALT');
    expect(stepIndex(doc, P1, 'Resolve Test Approach')).toBeGreaterThan(-1);
    expect(stepIndex(doc, P1, 'Resolve Test Approach')).toBeLessThan(stepIndex(doc, P1, 'Requirements Validation'));
  });

  test('Foreman table mode skips the resolver, so it gains no new dependency on Node or the CLI', () => {
    const first = String(step(doc, P1, 'Resolve Test Approach').actions[0]);
    expect(first).toContain("If $ARGUMENTS contains '--parser-tables': skip this step");
    expect(first).toContain('BDD_MODE is disabled');
  });

  test('step numbering stays sequential from 1', () => {
    for (const phase of doc.workflow.phases) {
      expect(phase.steps.map((s) => s.order)).toEqual(phase.steps.map((_, i) => i + 1));
    }
  });

  test('the >=3 scenario floor is stated only against BDD_MODE', () => {
    const lines = read('create-trd.yaml').split('\n').filter((l) => /(>=3|fewer than 3)/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/BDD_MODE/);
  });

  test('with BDD off the floor is a note that never blocks and never lowers the score', () => {
    const text = actions(doc, P1, 'Requirements Validation');
    expect(text).toContain('If BDD_MODE.enabled, flag any functional REQ-NNN with fewer than 3');
    expect(text).toContain('never blocks or lowers the score');
  });

  test('the test-task step is no longer titled or described as BDD, and still pairs every -TEST task', () => {
    const t = step(doc, 'Task Breakdown and Planning', 'Test Task Generation');
    expect(t).toBeDefined();
    expect(t.description).not.toMatch(/BDD|Reqnroll/i);
    expect(t.actions.map(String).join('\n')).toContain('generate a TRD-NNN-TEST task');
  });

  test('the saved TRD records the decision as test_approach frontmatter', () => {
    const text = actions(doc, 'Output Management', 'TRD Document Generation');
    expect(text).toContain('`test_approach` (`bdd-reqnroll` if BDD_MODE.enabled, else `standard`;');
  });

  test('only an explicit choice is stamped: a TRD written on the default carries no test_approach', () => {
    const text = actions(doc, 'Output Management', 'TRD Document Generation');
    expect(text).toContain('omit it when BDD_MODE.source is `default`');
  });
});

describe('implement-trd-beads routes -TEST beads by BDD_MODE', () => {
  const doc = load('implement-trd-beads.yaml');

  test('resolves BDD_MODE from the TRD in Preflight, before any bead or git side effect', () => {
    const text = actions(doc, 'Preflight', 'TRD selection and validation');
    expect(text).toContain('resolve-bdd --trd');
    expect(text).toContain('BDD_MODE');
    const preflightIdx = doc.workflow.phases.findIndex((p) => p.name === 'Preflight');
    const scaffoldIdx = doc.workflow.phases.findIndex((p) => p.name === 'Scaffold');
    expect(preflightIdx).toBeLessThan(scaffoldIdx);
  });

  test('has a Reqnroll branch and an explicit non-Reqnroll branch for isTest beads', () => {
    const text = actions(doc, 'Scaffold', 'Plan and create beads');
    expect(text).toContain('If BDD_MODE.enabled the specialist follows "TRD commands" in `packages/reqnroll/skills/reqnroll/SKILL.md`');
    expect(text).toContain("otherwise it writes them in the repo's own framework");
    // The off branch still runs the tests, through the toolchain capability, and keeps test-first order.
    expect(text).toContain('test-runner.run');
    expect(text).toContain('RED before the paired implementation bead goes GREEN');
  });
});

describe('the BDD-on procedure lives in the reqnroll skill, and both commands point at it', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'reqnroll', 'skills', 'reqnroll', 'SKILL.md'), 'utf8');
  const section = skill.slice(skill.indexOf('## TRD commands'));

  test('the skill has a "TRD commands" section covering both commands', () => {
    expect(skill).toContain('## TRD commands');
    expect(section).toContain('create-trd');
    expect(section).toContain('at least 3 AC-NNN-M');
    expect(section).toContain('test_approach: bdd-reqnroll');
    expect(section).toContain('implement-trd-beads');
    expect(section).toContain('generate-bindings <PRD_PATH> --out tests --sut <SUT_CSPROJ>');
    expect(section).toMatch(/confirm \*\*red\*\*[\s\S]*re-confirm \*\*red\*\*/);
  });

  test.each(['create-trd.yaml', 'implement-trd-beads.yaml'])('%s points at that section', (file) => {
    // skill prose: the quotes around TRD commands are plain here (escaped in the YAML scalar this was written against)
    expect(read(file)).toMatch(/TRD commands\\?" in `packages\/reqnroll\/skills\/reqnroll\/SKILL\.md`/);
  });
});
